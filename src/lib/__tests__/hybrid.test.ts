import { describe, it, expect } from "vitest";
import { toFtsQuery, fuseRanks } from "@/lib/hybrid";

describe("toFtsQuery", () => {
  it("ORs the query's words, each quoted so punctuation can't become FTS syntax", () => {
    expect(toFtsQuery('JWT clock-skew: "fix"!')).toBe('"jwt" OR "clock" OR "skew" OR "fix"');
  });

  it("keeps identifiers with underscores whole", () => {
    expect(toFtsQuery("ERR_PNPM_BAD_PM_VERSION in CI")).toBe('"err_pnpm_bad_pm_version" OR "in" OR "ci"');
  });

  it("drops repeats and one-character words", () => {
    expect(toFtsQuery("pool a POOL pool")).toBe('"pool"');
  });

  it("returns an empty string when nothing is searchable", () => {
    expect(toFtsQuery("? ! -")).toBe("");
  });
});

describe("fuseRanks", () => {
  it("adds 1/(k + rank) across lists, best first", () => {
    const fused = fuseRanks([[1, 2, 3], [3, 4]], 10);
    expect(fused.map((f) => f.id)).toEqual([3, 1, 2, 4]);
    expect(fused[0].score).toBeCloseTo(1 / 13 + 1 / 11, 10);
  });

  it("handles an empty list", () => {
    expect(fuseRanks([[], [7]], 10)).toEqual([{ id: 7, score: 1 / 11 }]);
  });
});
