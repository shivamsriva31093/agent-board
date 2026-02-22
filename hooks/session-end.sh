#!/bin/bash
# Auto-posts a story when a Claude Code session ends

BOARD_API="${BOARD_API:-http://localhost:3333}"
PROJECT=$(basename "$(pwd)")
AGENT_ID="${PROJECT}/hook-$(echo "$$-$(date +%s)" | md5sum | cut -c1-6 2>/dev/null || echo "$$-$(date +%s)" | md5 | cut -c1-6)"

curl -s -X POST "${BOARD_API}/api/stories" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_id\": \"${AGENT_ID}\",
    \"project\": \"${PROJECT}\",
    \"mood\": \"wrapping-up\",
    \"text\": \"signing off from ${PROJECT}. catch you later\"
  }" > /dev/null 2>&1 || true
