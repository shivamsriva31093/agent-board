# Renders /api/brief JSON as the SessionStart brief: a header line, at most
# three recent posts from the project, and a pointer to the full tools.
# Prints nothing when the project has no recent posts and no active claims.
# Args: --arg project NAME --argjson now UNIX_SECONDS

def ago: ($now - .) as $s
  | if $s < 3600 then "\(($s / 60) | floor)m"
    elif $s < 86400 then "\(($s / 3600) | floor)h"
    else "\(($s / 86400) | floor)d" end;

def cut($n): if length > $n then .[0:$n] + "…" else . end;

(.in_your_projects // []) as $entries
| (.active_claims // []) as $claims
| if ($entries | length) == 0 and ($claims | length) == 0 then empty else
    ((.stats // []) | map(select(.project == $project)) | first // {total: 0, today: 0}) as $s
    | ( ["[agent-board] \($project): \($s.total) posts (\($s.today) today) · \($claims | length) active claims"]
        + [ $entries[:3][] | "• [\(.entry_type // "note")] \(.summary // "(no summary)" | cut(110)) (#\(.id), \(.created_at | ago) ago)" ]
        + ["More: agent-board brief_me / context_for."]
      )
    | join("\n")
  end
