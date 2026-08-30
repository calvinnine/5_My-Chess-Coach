import { describe, expect, it } from "vitest";
import { hasFinalConsonant, withParticle } from "@/lib/korean";
import { PIECE_NAMES } from "@/lib/analysis/themes";

describe("Korean particle selection", () => {
  it("detects a final consonant", () => {
    expect(hasFinalConsonant("퀸")).toBe(true);
    expect(hasFinalConsonant("폰")).toBe(true);
    expect(hasFinalConsonant("나이트")).toBe(false);
    expect(hasFinalConsonant("비숍")).toBe(true);
  });

  it("returns false for non-Hangul so the caller still gets a sentence", () => {
    expect(hasFinalConsonant("Nf3")).toBe(false);
    expect(hasFinalConsonant("")).toBe(false);
  });

  it("picks the right form of each particle pair", () => {
    expect(withParticle("퀸", "이/가")).toBe("퀸이");
    expect(withParticle("나이트", "이/가")).toBe("나이트가");
    expect(withParticle("룩", "은/는")).toBe("룩은");
    expect(withParticle("나이트", "은/는")).toBe("나이트는");
    expect(withParticle("폰", "을/를")).toBe("폰을");
    expect(withParticle("나이트", "을/를")).toBe("나이트를");
  });

  it("gives every piece name a grammatical subject particle", () => {
    // Regression: the hanging-piece message used a bare "가", producing
    // "퀸가" / "폰가" in real reviews.
    const expected: Record<string, string> = {
      폰: "폰이",
      나이트: "나이트가",
      비숍: "비숍이",
      룩: "룩이",
      퀸: "퀸이",
      킹: "킹이",
    };
    for (const name of Object.values(PIECE_NAMES)) {
      expect(withParticle(name, "이/가")).toBe(expected[name]);
    }
  });
});
