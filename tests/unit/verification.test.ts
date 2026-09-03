import { describe, expect, it } from "vitest";
import {
  isChallengeCode,
  makeChallengeCode,
  normalizeUsername,
  profileProvesOwnership,
} from "@/lib/auth/verification";
import type { ChessComProfile } from "@/lib/chesscom/schemas";

function profile(fields: Partial<ChessComProfile> = {}): ChessComProfile {
  return { username: "calvinnine", ...fields };
}

describe("the challenge code", () => {
  it("is recognisable and unique per call", () => {
    const a = makeChallengeCode();
    const b = makeChallengeCode();
    expect(isChallengeCode(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("rejects anything that is not one of ours", () => {
    // Otherwise a caller could pass arbitrary text and have it "matched".
    expect(isChallengeCode("")).toBe(false);
    expect(isChallengeCode("mychess-")).toBe(false);
    expect(isChallengeCode("mychess-XYZ")).toBe(false);
    expect(isChallengeCode("서울")).toBe(false);
  });
});

describe("proving the account is yours", () => {
  const code = "mychess-0123456789";

  it("accepts the code in the location field", () => {
    expect(profileProvesOwnership(profile({ location: code }), code)).toBe(true);
  });

  it("accepts the code in the name field", () => {
    expect(profileProvesOwnership(profile({ name: code }), code)).toBe(true);
  });

  it("lets the owner keep their real name alongside the code", () => {
    expect(
      profileProvesOwnership(profile({ name: `이혁성 ${code}`, location: "Seoul" }), code),
    ).toBe(true);
  });

  it("ignores case, because profile fields get retyped", () => {
    expect(profileProvesOwnership(profile({ location: code.toUpperCase() }), code)).toBe(true);
  });

  it("refuses a profile without the code", () => {
    expect(profileProvesOwnership(profile({ name: "이혁성", location: "Seoul" }), code)).toBe(
      false,
    );
  });

  it("refuses an empty profile", () => {
    expect(profileProvesOwnership(profile(), code)).toBe(false);
  });

  it("refuses a different code", () => {
    expect(profileProvesOwnership(profile({ location: "mychess-ffffffffff" }), code)).toBe(
      false,
    );
  });

  it("never matches on the username, which the claimant does not control", () => {
    /*
     * A handle is not free text the account holder can edit on demand in the
     * way name and location are, and treating it as proof would let someone
     * who registered a lucky handle pass without doing anything.
     */
    expect(profileProvesOwnership(profile({ username: code }), code)).toBe(false);
  });

  it("refuses to match when the code is not one we issued", () => {
    // Guards against a caller smuggling in a substring that is in every profile.
    expect(profileProvesOwnership(profile({ location: "Seoul" }), "Seoul")).toBe(false);
    expect(profileProvesOwnership(profile({ name: "a" }), "a")).toBe(false);
  });
});

describe("handles", () => {
  it("lower-cases and trims", () => {
    expect(normalizeUsername("  CalvinNine ")).toBe("calvinnine");
  });

  it("rejects what Chess.com would not accept", () => {
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("a".repeat(26))).toBeNull();
    expect(normalizeUsername("has space")).toBeNull();
    expect(normalizeUsername("../etc/passwd")).toBeNull();
  });
});
