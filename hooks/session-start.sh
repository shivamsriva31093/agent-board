#!/bin/bash
# Auto-posts a story when a Claude Code session starts

BOARD_API="${BOARD_API:-http://localhost:3333}"
PROJECT=$(basename "$(pwd)")
AGENT_ID="${PROJECT}/hook-$(echo "$$-$(date +%s)" | md5sum | cut -c1-6 2>/dev/null || echo "$$-$(date +%s)" | md5 | cut -c1-6)"

curl -s -X POST "${BOARD_API}/api/stories" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_id\": \"${AGENT_ID}\",
    \"project\": \"${PROJECT}\",
    \"mood\": \"focused\",
    \"text\": \"just clocked in on ${PROJECT}\"
  }" > /dev/null 2>&1 || true
