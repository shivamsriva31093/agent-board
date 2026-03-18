export interface ParsedQuery {
  intent: "id" | "question" | "search";
  id?: number;
  query_clean: string;
  filters: {
    project?: string;
    type?: string;
    agent?: string;
    since?: string;
  };
}

const QUESTION_STARTERS = /^(what|why|how|who|which|where|when|show me|tell me)\b/i;
const FILTER_PATTERN = /\b(project|type|by|since):(\S+)/g;
const TRAILING_PUNCTUATION = /[?!.,;]+$/;
const ID_PATTERN = /^#?(\d+)$/;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  // 1. ID detection
  const idMatch = trimmed.match(ID_PATTERN);
  if (idMatch) {
    return {
      intent: "id",
      id: parseInt(idMatch[1], 10),
      query_clean: trimmed,
      filters: {},
    };
  }

  // 2. Extract filters
  const filters: ParsedQuery["filters"] = {};
  const cleaned = trimmed
    .replace(FILTER_PATTERN, (match, key: string, value: string) => {
      // Strip trailing punctuation from filter values (e.g. "project:foo?" -> "foo")
      const cleanValue = value.replace(TRAILING_PUNCTUATION, "");
      // Preserve any stripped punctuation back in the string
      const stripped = match.slice(key.length + 1 + cleanValue.length);
      switch (key) {
        case "project":
          filters.project = cleanValue;
          break;
        case "type":
          filters.type = cleanValue;
          break;
        case "by":
          filters.agent = cleanValue;
          break;
        case "since":
          filters.since = cleanValue;
          break;
      }
      return stripped;
    })
    .replace(/\s+/g, " ")
    .replace(/\s+([?!.,;])/g, "$1")
    .trim();

  // 3. Question detection
  const isQuestion = QUESTION_STARTERS.test(cleaned) || cleaned.endsWith("?");

  return {
    intent: isQuestion ? "question" : "search",
    query_clean: cleaned,
    filters,
  };
}
