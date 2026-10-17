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

/** True if `needle` appears as a contiguous run inside `hay`. */
function containsRun(hay: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
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
  if (containsRun(f, s)) return s.length;
  if (containsRun(s, f)) return f.length;
  return 0;
}

/**
 * Whether a scope match is specific enough to count. A single shared segment
 * ("README.md", "src") is ambiguous across repos, so it only counts when the
 * entry or claim comes from the caller's own project.
 */
export function isRelevantScopeMatch(depth: number, sameProject: boolean): boolean {
  return depth >= 2 || (depth >= 1 && sameProject);
}
