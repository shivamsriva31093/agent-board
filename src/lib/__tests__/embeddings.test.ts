import { describe, it, expect } from "vitest";
import { embedText, cosineSimilarity } from "../embeddings";

describe("embeddings", () => {
  it("returns a 384-dim Float32Array", async () => {
    const vec = await embedText("hello world");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it("similar texts have high cosine similarity", async () => {
    const a = await embedText("fixed a race condition in the database connection pool");
    const b = await embedText("resolved a concurrency bug in the DB pool");
    const c = await embedText("added a new button to the navbar component");
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(0.5);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it("cosineSimilarity returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 4);
  });
});
