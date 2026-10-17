#!/bin/bash
# Adds agent-board's Claude Code hooks to ~/.claude/settings.json, keeping
# every other setting and hook. Replaces earlier agent-board hook entries
# instead of duplicating them, and backs the file up first.
# Usage: bash install-hooks.sh [--port 3333] [--dry-run] [--uninstall]

PORT=3333
DRY_RUN=0
REMOVE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) REMOVE=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/../../../.." && pwd -P)"
SETTINGS="$HOME/.claude/settings.json"
# Trailing "# agent-board-hook" marks entries this script owns.
cmd() { printf 'BOARD_API=http://127.0.0.1:%s bash "%s/hooks/%s" # agent-board-hook' "$PORT" "$REPO" "$1"; }

CURRENT='{}'
if [ -f "$SETTINGS" ]; then
  CURRENT=$(cat "$SETTINGS")
  printf '%s' "$CURRENT" | jq -e 'type == "object"' >/dev/null 2>&1 || {
    echo "$SETTINGS is not a JSON object; fix it by hand first" >&2; exit 1; }
fi

UPDATED=$(printf '%s' "$CURRENT" | jq \
  --argjson remove "$REMOVE" \
  --arg start "$(cmd session-start.sh)" \
  --arg end "$(cmd session-end.sh)" \
  --arg edit "$(cmd pre-edit-context.sh)" '
  def ours: (.command // "") | test("agent-board-hook|/hooks/(session-start|session-end|pre-edit-context)\\.sh");
  def strip: map(.hooks |= map(select(ours | not))) | map(select((.hooks | length) > 0));
  def add($event; $entry): .hooks[$event] = ((.hooks[$event] // []) + [$entry]);
  .hooks //= {}
  | reduce ("SessionStart", "SessionEnd", "PreToolUse") as $e (.;
      if .hooks[$e] then .hooks[$e] |= strip else . end)
  | if $remove then . else
      add("SessionStart"; {hooks: [{type: "command", command: $start}]})
      | add("SessionEnd"; {hooks: [{type: "command", command: $end}]})
      | add("PreToolUse"; {matcher: "Edit|Write", hooks: [{type: "command", command: $edit}]})
    end
  | .hooks |= with_entries(select(.value != []))
  | if .hooks == {} then del(.hooks) else . end') || { echo "failed to update settings" >&2; exit 1; }

if [ "$DRY_RUN" = 1 ]; then
  diff <(printf '%s' "$CURRENT" | jq -S .) <(printf '%s' "$UPDATED" | jq -S .)
  exit 0
fi

mkdir -p "$(dirname "$SETTINGS")"
if [ -f "$SETTINGS" ]; then
  BACKUP="$SETTINGS.bak-agent-board-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS" "$BACKUP" && echo "backup: $BACKUP"
fi
printf '%s\n' "$UPDATED" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
if [ "$REMOVE" = true ]; then echo "agent-board hooks removed from $SETTINGS"
else echo "agent-board hooks installed in $SETTINGS (SessionStart, SessionEnd, PreToolUse Edit|Write)"; fi
