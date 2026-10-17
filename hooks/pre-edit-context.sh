#!/bin/bash
# Pre-edit hook: injects agent-board context before Edit/Write tool calls.
# Reads tool input JSON from stdin, extracts file_path, calls the board API.

BOARD_API="${BOARD_API:-http://localhost:3333}"

# Read tool input from stdin
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null)
if [ -z "$FILE_PATH" ]; then exit 0; fi

# Dedup: skip if already fetched this session ($$ scopes to this shell process tree)
CACHE="/tmp/agent-board-context-$$"
if [ -f "$CACHE" ] && grep -qF "$FILE_PATH" "$CACHE" 2>/dev/null; then exit 0; fi
echo "$FILE_PATH" >> "$CACHE"

# Fetch context (2s timeout — never block work)
ENCODED=$(printf '%s' "$FILE_PATH" | jq -sRr @uri 2>/dev/null || printf '%s' "$FILE_PATH")
RESULT=$(curl -s --max-time 2 \
  "${BOARD_API}/api/entries/context?files=${ENCODED}&max_tokens=300" \
  2>/dev/null)
if [ -z "$RESULT" ] || [ "$RESULT" = "null" ]; then exit 0; fi

# Check if there's anything to show
ENTRY_COUNT=$(echo "$RESULT" | jq '.entries | length' 2>/dev/null || echo "0")
CLAIM_COUNT=$(echo "$RESULT" | jq '.claims | length' 2>/dev/null || echo "0")
CONFLICT_COUNT=$(echo "$RESULT" | jq '.conflicts | length' 2>/dev/null || echo "0")

if [ "$ENTRY_COUNT" = "0" ] && [ "$CLAIM_COUNT" = "0" ]; then exit 0; fi

# Format output
echo "[agent-board context for $FILE_PATH]"

# Conflicts first
if [ "$CONFLICT_COUNT" != "0" ] && [ "$CONFLICT_COUNT" != "null" ]; then
  echo "$RESULT" | jq -r '.conflicts[]? | "\u26a0 CONFLICT on \(.scope): " + (.entries | map("#\(.id) \(.entry_type // "note"): \(.summary // "(no summary)")") | join(" \u2194 "))'
fi

# Claims
if [ "$CLAIM_COUNT" != "0" ]; then
  echo "$RESULT" | jq -r '.claims[]? | "\u26a0 \(.agent_id) has \"\(.scope)\" claimed (\(.scope_type))"'
fi

# Entries (top 5)
if [ "$ENTRY_COUNT" != "0" ]; then
  echo "$RESULT" | jq -r '.entries[:5][] | "\u2022 [\(.entry_type // "note")\(if .stale then " \u26a0 stale" else "" end)] \(.summary // "(no summary)") (id:\(.id))"'
fi
