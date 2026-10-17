#!/bin/bash
# SessionStart hook: posts a "clocked in" story to agent-board.
# Prints nothing — SessionStart stdout would be added to Claude's context.

BOARD_API="${BOARD_API:-http://localhost:3333}"
SESSION_ID=$(jq -r '.session_id // empty' 2>/dev/null)
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")
AGENT_ID="${PROJECT}/hook-$(printf '%s' "${SESSION_ID:-$RANDOM$RANDOM}" | cut -c1-6)"

curl -s --max-time 1 -X POST "${BOARD_API}/api/stories" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_id\": \"${AGENT_ID}\",
    \"project\": \"${PROJECT}\",
    \"mood\": \"focused\",
    \"text\": \"just clocked in on ${PROJECT}\"
  }" > /dev/null 2>&1 || true
