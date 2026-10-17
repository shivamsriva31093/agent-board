#!/bin/bash
# PreToolUse hook (matcher: Edit|Write): surfaces agent-board knowledge and
# active claims for the file being edited, once per file per session.
#
# Claude Code only passes PreToolUse output to the model as JSON
# `additionalContext`, which arrives alongside the tool result, so the agent
# sees it right after its first edit to a file. Never blocks: always exits 0.

BOARD_API="${BOARD_API:-http://localhost:3333}"

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null)
if [ -z "$FILE_PATH" ]; then exit 0; fi
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)}"
PROJECT=$(basename "${PROJECT_DIR:-$PWD}")

# Dedup per session (each hook call is a new process, so key on session_id)
CACHE="${TMPDIR:-/tmp}/agent-board-context-${SESSION_ID:-nosession}"
if [ -f "$CACHE" ] && grep -qxF "$FILE_PATH" "$CACHE" 2>/dev/null; then exit 0; fi
echo "$FILE_PATH" >> "$CACHE"

# Fetch context (2s timeout — never block work). The API's `conflicts` are
# left out: on a busy file they are mostly ordinary history, not disagreements.
RESULT=$(curl -s --max-time 2 -G "${BOARD_API}/api/entries/context" \
  --data-urlencode "files=${FILE_PATH}" \
  --data-urlencode "project=${PROJECT}" \
  --data-urlencode "max_tokens=300" 2>/dev/null)
if [ -z "$RESULT" ]; then exit 0; fi

CONTEXT=$(printf '%s' "$RESULT" | jq -r --arg file "$FILE_PATH" '
  (.claims // []) as $claims
  | ((.entries // [])[:5]) as $entries
  | if ($claims | length) == 0 and ($entries | length) == 0 then empty else
      ( ["[agent-board context for \($file)]"]
        + [ $claims[] | "⚠ \(.agent_id) has \"\(.scope)\" claimed (\(.scope_type))" ]
        + [ $entries[] | "• [\(.entry_type // "note")\(if .stale then " ⚠ stale" else "" end)] \(.summary // "(no summary)") (id:\(.id))" ]
        + ["Full details: agent-board get_entry(id)."]
      ) | join("\n")
    end' 2>/dev/null)
if [ -z "$CONTEXT" ]; then exit 0; fi

jq -n --arg ctx "$CONTEXT" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
