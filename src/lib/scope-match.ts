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
 * relative to that project's checkout, so its "src/db" must not match every
 * repo's "src/db". It counts when:
 *  - the scope names the file (or an ancestor) and a directory named for
 *    the owning project (its id or a registered repo path) comes before the
 *    end of the match, i.e. the file sits inside that project; or
 *  - the file is a relative path under the caller's root and the scope names
 *    the caller's directory just before it ("agent-board/hooks/x.sh" for
 *    "hooks/x.sh" in agent-board).
 */
export function relevantMatchDepth(
  scope: string,
  file: string,
  opts: { sameProject: boolean; ownerRepoNames: string[]; callerRepoNames: string[] },
): number {
  const s = segments(scope);
  const f = segments(file);
  if (s.length === 0 || f.length === 0) return 0;
  const forward = runStarts(f, s);
  const reverse = forward.length > 0 ? [] : runStarts(s, f);
  const depth = forward.length > 0 ? s.length : reverse.length > 0 ? f.length : 0;
  if (depth === 0 || opts.sameProject) return depth;

  if (forward.length > 0) {
    const anchors = f.flatMap((seg, i) => (opts.ownerRepoNames.includes(seg) ? [i] : []));
    return forward.some((start) => anchors.some((a) => a < start + s.length - 1)) ? depth : 0;
  }
  return reverse.some((start) => start > 0 && opts.callerRepoNames.includes(s[start - 1])) ? depth : 0;
}
