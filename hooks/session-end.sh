#!/bin/bash
# SessionEnd hook: posts a "signing off" story to agent-board.
# SessionEnd hooks share a 1.5s budget by default, hence the short timeout.

BOARD_API="${BOARD_API:-http://localhost:3333}"
SESSION_ID=$(jq -r '.session_id // empty' 2>/dev/null)
PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")
AGENT_ID="${PROJECT}/hook-$(printf '%s' "${SESSION_ID:-$RANDOM$RANDOM}" | cut -c1-6)"

curl -s --max-time 1 -X POST "${BOARD_API}/api/stories" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_id\": \"${AGENT_ID}\",
    \"project\": \"${PROJECT}\",
    \"mood\": \"wrapping-up\",
    \"text\": \"signing off from ${PROJECT}. catch you later\"
  }" > /dev/null 2>&1 || true
