/**
 * Token counting for budget tests. cl100k_base is a proxy: Claude's own
 * tokenizer differs, but dense text (ids, emoji, paths) tokenizes similarly.
 */
import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");

export function countTokens(text: string): number {
  return encoder.encode(text).length;
}
