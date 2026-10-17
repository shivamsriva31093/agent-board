import { describe, it, expect } from "vitest";
import { recallAtK, reciprocalRank } from "@/eval/harness";

describe("eval metrics", () => {
  it("recallAtK counts expected ids in the top k", () => {
    expect(recallAtK([3, 1, 2], [1, 9], 5)).toBe(0.5);
    expect(recallAtK([3, 1, 2], [1], 1)).toBe(0);
  });

  it("reciprocalRank uses the first expected hit", () => {
    expect(reciprocalRank([7, 4, 1], [1, 4])).toBe(0.5);
    expect(reciprocalRank([7], [1])).toBe(0);
  });
});
