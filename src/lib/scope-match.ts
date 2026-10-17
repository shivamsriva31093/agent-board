/**
 * Path-scope matching for entries and claims.
 *
 * Agents record scopes relative to wherever they were running
 * ("src/db/service.ts", "agent-board/hooks/"), while callers such as the
 * pre-edit hook pass absolute paths. Prefix checks can't line those up, so
 * matching is done on whole path segments instead.
 */

function segments(p: string): string[] {
  return p.trim().split("/").filter((s) => s !== "" && s !== ".");
}

/** Indexes in `hay` where `needle` appears as a contiguous run. */
function runStarts(hay: string[], needle: string[]): number[] {
  const starts: number[] = [];
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    starts.push(i);
  }
  return starts;
}

/**
 * Number of path segments `scope` and `file` share when one names the other
 * or one of its ancestor directories; 0 when they don't match.
 *
 *   scopeMatchDepth("agent-board/hooks/", "/repo/agent-board/hooks/x.sh") → 2
 *   scopeMatchDepth("hooks/x.sh", "/repo/hooks/x-y.sh")                   → 0
 */
export function scopeMatchDepth(scope: string, file: string): number {
  const s = segments(scope);
  const f = segments(file);
  if (s.length === 0 || f.length === 0) return 0;
  if (runStarts(f, s).length > 0) return s.length;
  if (runStarts(s, f).length > 0) return f.length;
  return 0;
}

/**
 * Depth of a scope match that counts for the caller, or 0. Within the
 * caller's own project any match counts. Another project's scopes are
 * relative to that project's checkout, so they only count when the file
 * sits inside a directory named for that project (its id or a registered
 * repo path) at or before where the match starts; otherwise its "src/db"
 * would match every repo's "src/db".
 */
export function relevantMatchDepth(
  scope: string,
  file: string,
  opts: { sameProject: boolean; ownerRepoNames: string[] },
): number {
  const depth = scopeMatchDepth(scope, file);
  if (depth === 0 || opts.sameProject) return depth;
  const s = segments(scope);
  const f = segments(file);
  const anchors = f.flatMap((seg, i) => (opts.ownerRepoNames.includes(seg) ? [i] : []));
  if (anchors.length === 0) return 0;
  // The file is inside the owner's checkout if an owner directory comes at or before a match.
  return runStarts(f, s).some((start) => anchors.some((a) => a <= start)) ? depth : 0;
}
