import { describe, expect, it } from "vitest";
import { buildCurriculum, PERSPECTIVE_ORDER, type PhaseAccuracy } from "@/lib/coaching/curriculum";
import { MIN_SAMPLE_GAMES, type AggregatedPattern } from "@/lib/coaching/patterns";
import { ALL_TAGS, TAG_BY_ID } from "@/lib/coaching/tags";

function pattern(tag: string, severity: number): AggregatedPattern {
  const def = TAG_BY_ID[tag];
  const isStrength = def.coaching === "";
  return {
    tag,
    label: def.label,
    description: def.description,
    patternType: isStrength ? "strength" : "weakness",
    status: "confirmed",
    sampleSize: 100,
    windowSize: 30,
    occurrenceCount: 10,
    gameCount: 8,
    distinctOpenings: 3,
    distinctOpponents: 5,
    severityScore: severity,
    confidenceScore: 90,
    evidenceGameIds: [1, 2, 3],
    evidence: [{ gameId: 1, ply: 10, moveNumber: 5, san: "Nf3", detail: "…" }],
    openingSpecific: null,
    periodStart: 1,
    periodEnd: 2,
  };
}

const phase = (averageLossCp: number, blunders: number, share: number): PhaseAccuracy => ({
  plies: 1000,
  averageLossCp,
  blunders,
  mistakes: 50,
  blunderShare: share,
  blundersPerGame: 1,
});

const PHASES = {
  opening: phase(38, 195, 0.11),
  middlegame: phase(90, 1461, 0.8),
  endgame: phase(54, 170, 0.09),
};

describe("every tag has a home", () => {
  it("assigns each tag to one of the reported perspectives", () => {
    // A tag with no perspective would silently vanish from the guide.
    for (const tag of ALL_TAGS) {
      expect(PERSPECTIVE_ORDER).toContain(tag.perspective);
    }
  });

  it("reports every perspective, even the empty ones", () => {
    const curriculum = buildCurriculum({
      analyzedGames: 100,
      patterns: [],
      phaseAccuracy: PHASES,
      repertoireSplit: null,
    });
    expect(curriculum.reports.map((r) => r.perspective)).toEqual(PERSPECTIVE_ORDER);
  });
});

describe("routing patterns to perspectives", () => {
  const curriculum = buildCurriculum({
    analyzedGames: 100,
    patterns: [
      pattern("allowed_fork", 60),
      pattern("hanging_piece", 50),
      pattern("out_of_repertoire", 55),
      pattern("endgame_technique", 20),
      pattern("time_trouble", 30),
      pattern("king_safety", 25),
    ],
    phaseAccuracy: PHASES,
    repertoireSplit: null,
  });
  const report = (p: string) => curriculum.reports.find((r) => r.perspective === p)!;

  it("puts tactical problems under tactics", () => {
    expect(report("tactics").weaknesses.map((w) => w.tag)).toEqual([
      "allowed_fork",
      "hanging_piece",
    ]);
  });

  it("puts the repertoire gap under opening, not tactics", () => {
    expect(report("opening").weaknesses.map((w) => w.tag)).toEqual(["out_of_repertoire"]);
  });

  it("keeps clock habits out of the phase perspectives", () => {
    expect(report("habit").weaknesses.map((w) => w.tag)).toEqual(["time_trouble"]);
    for (const p of ["opening", "tactics", "strategy", "endgame"]) {
      expect(report(p).weaknesses.map((w) => w.tag)).not.toContain("time_trouble");
    }
  });

  it("attaches the matching phase accuracy", () => {
    expect(report("tactics").accuracy?.averageLossCp).toBe(90);
    expect(report("endgame").accuracy?.averageLossCp).toBe(54);
    expect(report("habit").accuracy).toBeNull();
  });

  it("gives every weakness at least one concrete drill", () => {
    for (const r of curriculum.reports) {
      expect(r.drills.length).toBeGreaterThan(0);
      for (const drill of r.drills) expect(drill.length).toBeGreaterThan(10);
    }
  });
});

describe("choosing the week's focus", () => {
  it("picks the perspective carrying the most severity", () => {
    const curriculum = buildCurriculum({
      analyzedGames: 100,
      patterns: [pattern("allowed_fork", 60), pattern("endgame_technique", 10)],
      phaseAccuracy: PHASES,
      repertoireSplit: null,
    });
    expect(curriculum.priority?.perspective).toBe("tactics");
  });

  it("adds up severity rather than taking the single worst", () => {
    // Three moderate opening problems outweigh one slightly larger tactic.
    const curriculum = buildCurriculum({
      analyzedGames: 100,
      patterns: [
        pattern("allowed_fork", 40),
        pattern("out_of_repertoire", 30),
        pattern("development_delay", 30),
        pattern("repeated_piece_move", 30),
      ],
      phaseAccuracy: PHASES,
      repertoireSplit: null,
    });
    expect(curriculum.priority?.perspective).toBe("opening");
  });

  it("names no focus when nothing is confirmed", () => {
    const curriculum = buildCurriculum({
      analyzedGames: 100,
      patterns: [],
      phaseAccuracy: PHASES,
      repertoireSplit: null,
    });
    expect(curriculum.priority).toBeNull();
  });
});

describe("the sample-size gate applies here too", () => {
  const curriculum = buildCurriculum({
    analyzedGames: MIN_SAMPLE_GAMES - 1,
    patterns: [pattern("allowed_fork", 90)],
    phaseAccuracy: PHASES,
    repertoireSplit: null,
  });

  it("stays in observing mode and names no focus", () => {
    expect(curriculum.observing).toBe(true);
    expect(curriculum.priority).toBeNull();
  });

  it("says so in every perspective headline", () => {
    for (const report of curriculum.reports) {
      expect(report.headline).toContain(`${MIN_SAMPLE_GAMES}판`);
    }
  });
});

describe("the opening perspective uses the repertoire split", () => {
  const split = {
    inside: { games: 450, score: 0.57, averageLossCp: 69 },
    outside: { games: 169, score: 0.43, averageLossCp: 80 },
    lossGapCp: 11,
    scoreGap: 0.14,
  };

  it("frames the opening problem as which opening, not opening play", () => {
    const curriculum = buildCurriculum({
      analyzedGames: 621,
      patterns: [pattern("out_of_repertoire", 55)],
      phaseAccuracy: PHASES,
      repertoireSplit: split,
    });
    const opening = curriculum.reports.find((r) => r.perspective === "opening")!;
    expect(opening.headline).toContain("어떤 오프닝");
    expect(opening.headline).toContain("69cp");
    expect(opening.headline).toContain("80cp");
    expect(opening.drills.join(" ")).toContain("모르겠다");
  });

  it("says the opening is fine when the two sides match", () => {
    const curriculum = buildCurriculum({
      analyzedGames: 621,
      patterns: [],
      phaseAccuracy: PHASES,
      repertoireSplit: { ...split, lossGapCp: 1, scoreGap: 0.01 },
    });
    const opening = curriculum.reports.find((r) => r.perspective === "opening")!;
    expect(opening.headline).toContain("급한 구간이 아닙니다");
  });
});
