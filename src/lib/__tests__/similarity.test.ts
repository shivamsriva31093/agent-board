import { describe, it, expect } from "vitest";
import { distanceToSimilarity } from "@/lib/similarity";

// sqlite-vec returns L2 distance; for unit vectors cosine = 1 - d²/2.
describe("distanceToSimilarity", () => {
  it("maps identical vectors to 1", () => {
    expect(distanceToSimilarity(0)).toBe(1);
  });

  it("maps distance 1 to cosine 0.5", () => {
    expect(distanceToSimilarity(1)).toBeCloseTo(0.5, 10);
  });

  it("maps orthogonal vectors (distance √2) to 0", () => {
    expect(distanceToSimilarity(Math.SQRT2)).toBeCloseTo(0, 10);
  });

  it("never goes negative, so multiplying by a weight can't flip the ranking", () => {
    expect(distanceToSimilarity(2)).toBe(0);
    expect(distanceToSimilarity(1.6)).toBe(0);
  });
});
