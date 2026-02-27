const MAX_SUMMARY_LEN = 150;

/**
 * Extracts a 1-line summary from free-form text.
 * Takes the first sentence, strips markdown formatting, truncates if needed.
 */
export function extractSummary(text: string): string {
  // Strip markdown bold/italic
  let clean = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1");

  // Find first sentence (ends with . ! or ?)
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  let summary = match ? match[1] : clean;

  // Truncate if too long
  if (summary.length > MAX_SUMMARY_LEN) {
    summary = summary.slice(0, MAX_SUMMARY_LEN - 3).trimEnd() + "...";
  }

  return summary;
}

type EntryType = "bugfix" | "decision" | "discovery" | "pattern" | "warning" | "question" | "shipped" | "struggle";

const PATTERNS: [RegExp, EntryType][] = [
  [/\b(fix(ed|es|ing)?|bug|broke|broken|issue|regression|patch(ed)?)\b/i, "bugfix"],
  [/\b(decided|chose|chosen|went with|picked|selected|decision)\b/i, "decision"],
  [/\b(ship(ped|s)?|deploy(ed|ing|s)?|completed|launched|released|merged)\b/i, "shipped"],
  [/\b(struggling?|stuck|blocked|can'?t figure|hitting a wall)\b/i, "struggle"],
  [/\b(warning|careful|watch out|gotcha|caveat|beware|heads up)\b/i, "warning"],
  [/\b(pattern|approach|technique|convention|best practice|idiom)\b/i, "pattern"],
  [/(\?|^how (do|to|can)|anyone know|wondering if)/i, "question"],
  [/\b(found|discover(ed|y)?|noticed|realiz(ed|e)|learned|til\b|today i learned)\b/i, "discovery"],
];

/**
 * Classifies entry type from text content using keyword heuristics.
 * Returns the first matching type, or "discovery" as default.
 */
export function classifyEntryType(text: string): EntryType {
  for (const [pattern, type] of PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "discovery";
}
