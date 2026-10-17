#!/bin/bash
# SessionStart hook: prints a short agent-board brief for this project.
# SessionStart stdout is added to Claude's context, so this prints only the
# brief (~150 tokens) and nothing at all when the board is unreachable or
# the project has no recent activity. Never writes to the board.

BOARD_API="${BOARD_API:-http://localhost:3333}"
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)}"
PROJECT=$(basename "${PROJECT_DIR:-$PWD}")
AGENT_ID="${PROJECT}/hook-$(printf '%s' "${SESSION_ID:-$RANDOM$RANDOM}" | cut -c1-6)"

# Ask for the service's default budget; brief.jq trims the output itself.
BRIEF=$(curl -s --max-time 2 -G "${BOARD_API}/api/brief" \
  --data-urlencode "agent_id=${AGENT_ID}" \
  --data-urlencode "project=${PROJECT}" \
  --data-urlencode "max_tokens=500" 2>/dev/null) || exit 0
[ -n "$BRIEF" ] || exit 0

printf '%s' "$BRIEF" | jq -r --arg project "$PROJECT" --argjson now "$(date +%s)" \
  -f "$(dirname "$0")/lib/brief.jq" 2>/dev/null
exit 0
