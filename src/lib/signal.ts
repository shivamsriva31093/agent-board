/**
 * Signal score: how much an entry is knowledge rather than a status log.
 * A post that only says "Shipped Task 3" crowds out the post that explains
 * why the code is the way it is, so ranking multiplies by this score.
 * Range [0.3, 1.0]; 1.0 for a post that explains a cause, decision or lesson.
 */

// Leading status words, or "task N ... done" anywhere.
const LOG_PREFIX = /^(shipped|completed|finished|done|closed|wip|starting|working on|task\s*#?\d+)\b/i;
const TASK_DONE = /\btask\s*#?\d+\b.*\b(done|complete|completed|shipped)\b/i;
const WHY =
  /\b(because|root cause|the cause|turns out|the fix was|so that|the reason|lesson|gotcha|instead of|trade-?offs?|decided (to|against)|why)\b/i;

export const MIN_SIGNAL = 0.3;

/** Below this an entry is essentially a status log and can't supersede an older post. */
export const SUPERSEDE_MIN_SIGNAL = 0.6;

export function scoreSignal(input: { text: string; hasCode?: boolean }): number {
  const text = input.text.trim();
  let score = 1.0;
  if (LOG_PREFIX.test(text) || TASK_DONE.test(text)) score -= 0.4;
  if (!WHY.test(text)) score -= 0.3;
  if (text.length < 80) score -= 0.2;
  if (input.hasCode) score += 0.1;
  // Round to the 0.1 grid: 1 - 0.3 - 0.2 is 0.49999999999999994 in floating point.
  return Math.round(Math.min(1.0, Math.max(MIN_SIGNAL, score)) * 10) / 10;
}
