#!/bin/bash
# Checks a running agent-board install end to end without leaving test data
# behind. On a brand-new board it writes one real first post (a setup
# record) to prove embeddings work; on an existing board it only reads.
# Usage: bash verify.sh [--port 3333]
# Prints OK / WARN / FAIL / SKIP lines; exits 1 if anything FAILs.

PORT=3333
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/../../../.." && pwd -P)"
API="http://127.0.0.1:$PORT"
FAILED=0
ok()   { echo "OK    $*"; }
warn() { echo "WARN  $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }
skip() { echo "SKIP  $*"; }

# 1. Service manager
case "$(uname -s)" in
  Darwin)
    if launchctl print "gui/$(id -u)/com.agent-board" 2>/dev/null | grep -q 'state = running'; then
      ok "launchd service com.agent-board is running"
    else warn "launchd service com.agent-board is not running (fine only if you start the board yourself)"; fi ;;
  Linux)
    if systemctl --user is-active --quiet agent-board 2>/dev/null; then ok "systemd user service agent-board is active"
    else warn "systemd user service agent-board is not active (fine only if you start the board yourself)"; fi ;;
esac

# 2. API
if ! curl -s --max-time 5 "$API/api/brief" | jq -e 'has("stats")' >/dev/null 2>&1; then
  fail "board API not answering at $API"
  echo "Stopping: the remaining checks need the API."; exit 1
fi
ok "board API answering at $API"

# 3. Network exposure (the API has no auth)
if command -v lsof >/dev/null 2>&1; then
  LISTEN=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u | tr '\n' ' ')
  case "$LISTEN" in
    *'*:'*|*'[::]:'*|*'0.0.0.0:'*) fail "board listens on all interfaces ($LISTEN); bind it to 127.0.0.1" ;;
    *) ok "board only listens on localhost ($LISTEN)" ;;
  esac
fi

# 4. Embeddings / semantic search. An intent-only context query returns
#    entries only through vector search, so a hit proves embeddings work.
#    The first run downloads a ~25 MB model, so allow up to 2 minutes.
semantic_hits() {
  curl -s --max-time 60 -G "$API/api/entries/context" --data-urlencode "intent=$1" \
    | jq -r '.entries[]?.id' 2>/dev/null
}
if [ "$(curl -s --max-time 5 "$API/api/entries?limit=1" | jq 'length' 2>/dev/null)" = "0" ]; then
  POST_ID=$(curl -s --max-time 120 -X POST "$API/api/entries" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg port "$PORT" '{agent_id: "agent-board/setup", project: "agent-board",
          text: "agent-board is set up on this machine: board server on 127.0.0.1:\($port), with the MCP server and Claude Code hooks connected. This is the first post, written by the setup check.",
          tags: ["agent-board", "setup"]}')" | jq -r '.entry_id // empty')
  if [ -z "$POST_ID" ]; then fail "could not create the first post"
  else
    FOUND=""
    for _ in $(seq 1 24); do
      semantic_hits "agent-board setup check first post" | grep -qx "$POST_ID" && { FOUND=1; break; }
      sleep 5
    done
    if [ -n "$FOUND" ]; then ok "semantic search works (first post #$POST_ID is embedded)"
    else fail "first post #$POST_ID was not embedded within 2 minutes; see the server error log"; fi
  fi
else
  if [ -n "$(semantic_hits "agent-board")" ]; then ok "semantic search returns results"
  else warn "semantic search returned nothing; embeddings may be unavailable"; fi
fi

# 5. Pre-edit hook, using a short-lived claim that is deleted afterwards. The
#    probe runs as its own project, so the claim is a same-project match.
PROBE=agent-board-setup-check
CLAIM_ID=$(curl -s --max-time 5 -X POST "$API/api/claims" -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"$PROBE/verify\",\"project\":\"$PROBE\",\"scope\":\"probe.txt\",\"scope_type\":\"file\",\"ttl_minutes\":2}" \
  | jq -r '.claim_id // empty')
if [ -z "$CLAIM_ID" ]; then fail "could not create a test claim"
else
  SESSION="setup-check-$$"
  OUT=$(printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/%s/probe.txt"}}' "$SESSION" "$PROBE" \
    | CLAUDE_PROJECT_DIR="/tmp/$PROBE" BOARD_API="$API" bash "$REPO/hooks/pre-edit-context.sh")
  if printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | contains("setup-check")' >/dev/null 2>&1; then
    ok "pre-edit hook returns board context"
  else fail "pre-edit hook did not return the expected context"; fi
  curl -s --max-time 5 -X DELETE "$API/api/claims/$CLAIM_ID" >/dev/null
  rm -f "${TMPDIR:-/tmp}/agent-board-context-$SESSION"
fi

# 6. Hooks registered in Claude Code settings
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ] && [ "$(jq '[.hooks[]?[]?.hooks[]?.command // "" | select(test("agent-board-hook"))] | length' "$SETTINGS" 2>/dev/null)" = "2" ]; then
  ok "2 agent-board hooks registered in $SETTINGS (SessionStart, PreToolUse Edit|Write)"
else
  skip "agent-board hooks not registered in $SETTINGS (only a problem if the user wanted them)"
fi

# 7. MCP server registered and connecting
if command -v claude >/dev/null 2>&1; then
  MCP_LINE=$(claude mcp list 2>/dev/null | grep -E '^agent-board:')
  case "$MCP_LINE" in
    *Connected*) ok "MCP server agent-board connected" ;;
    "") fail "MCP server agent-board is not registered with Claude Code" ;;
    *) fail "MCP server agent-board is registered but not connecting: $MCP_LINE" ;;
  esac
else
  skip "claude CLI not found; can't check the MCP registration"
fi

exit $FAILED
