import { describe, expect, it } from "vitest";
import {
  aggregatePatterns,
  CONFIRMED_MIN_GAMES,
  MIN_SAMPLE_GAMES,
  topWeaknesses,
  type PatternGameInput,
} from "@/lib/coaching/patterns";
import { buildTrainingTasks } from "@/lib/coaching/training";

const DAY = 86_400;

function game(
  id: number,
  tags: string[],
  opts: { opening?: string | null; opponent?: string } = {},
): PatternGameInput {
  return {
    gameId: id,
    playedAt: 1_760_000_000 - id * DAY,
    openingFamily: opts.opening === undefined ? "Sicilian Defense" : opts.opening,
    opponentUsername: opts.opponent ?? `opp${id}`,
    result: "loss",
    occurrences: tags.map((tag, i) => ({
      tag,
      ply: 20 + i,
      moveNumber: 10 + i,
      san: "Nf3",
      detail: `${tag} 발생`,
    })),
  };
}

describe("sample-size guardrails", () => {
  it("never confirms a weakness below the minimum analysed sample", () => {
    const games = Array.from({ length: MIN_SAMPLE_GAMES - 1 }, (_, i) =>
      game(i + 1, ["hanging_piece"]),
    );
    const patterns = aggregatePatterns(games);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].status).toBe("observing");
  });

  it("promotes to candidate at 3 occurrences inside the recent-20 window", () => {
    const games = [
      ...Array.from({ length: 3 }, (_, i) => game(i + 1, ["hanging_piece"])),
      ...Array.from({ length: 9 }, (_, i) => game(i + 10, [])),
    ];
    const patterns = aggregatePatterns(games);
    expect(patterns[0].status).toBe("candidate");
  });

  it("requires two distinct openings before confirming", () => {
    const sameOpening = [
      ...Array.from({ length: CONFIRMED_MIN_GAMES }, (_, i) =>
        game(i + 1, ["hanging_piece"], { opening: "Sicilian Defense" }),
      ),
      ...Array.from({ length: 8 }, (_, i) => game(i + 20, [])),
    ];
    expect(aggregatePatterns(sameOpening)[0].status).toBe("candidate");

    const mixed = [
      ...Array.from({ length: CONFIRMED_MIN_GAMES }, (_, i) =>
        game(i + 1, ["hanging_piece"], {
          opening: i % 2 === 0 ? "Sicilian Defense" : "French Defense",
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) => game(i + 20, [])),
    ];
    expect(aggregatePatterns(mixed)[0].status).toBe("confirmed");
  });

  it("marks an opening-specific problem when it repeats in one family", () => {
    const games = [
      ...Array.from({ length: 4 }, (_, i) =>
        game(i + 1, ["development_delay"], { opening: "Sicilian Defense" }),
      ),
      ...Array.from({ length: 8 }, (_, i) => game(i + 20, [])),
    ];
    expect(aggregatePatterns(games)[0].openingSpecific).toBe("Sicilian Defense");
  });
});

describe("determinism", () => {
  it("produces identical scores for the same input regardless of input order", () => {
    const games = [
      game(1, ["hanging_piece", "time_trouble"]),
      game(2, ["hanging_piece"], { opening: "French Defense" }),
      game(3, ["allowed_fork"]),
      ...Array.from({ length: 10 }, (_, i) => game(i + 10, ["hanging_piece"])),
    ];
    const a = aggregatePatterns(games);
    const b = aggregatePatterns([...games].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("evidence", () => {
  it("attaches evidence games to every reported pattern", () => {
    const games = Array.from({ length: 12 }, (_, i) => game(i + 1, ["hanging_piece"]));
    for (const pattern of aggregatePatterns(games)) {
      expect(pattern.evidenceGameIds.length).toBeGreaterThan(0);
      expect(pattern.evidence.length).toBeGreaterThan(0);
    }
  });

  it("gives every confirmed weakness at least three evidence scenes", () => {
    const games = [
      ...Array.from({ length: 6 }, (_, i) =>
        game(i + 1, ["hanging_piece"], {
          opening: i % 2 === 0 ? "Sicilian Defense" : "Caro-Kann Defense",
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) => game(i + 20, [])),
    ];
    for (const pattern of aggregatePatterns(games).filter((p) => p.status === "confirmed")) {
      expect(pattern.evidence.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("separates strengths from weaknesses", () => {
    const games = Array.from({ length: 12 }, (_, i) =>
      game(i + 1, ["hanging_piece", "resilient_defense"]),
    );
    const patterns = aggregatePatterns(games);
    expect(patterns.find((p) => p.tag === "resilient_defense")?.patternType).toBe("strength");
    expect(patterns.find((p) => p.tag === "hanging_piece")?.patternType).toBe("weakness");
    expect(topWeaknesses(patterns).every((p) => p.patternType === "weakness")).toBe(true);
  });
});

describe("training tasks", () => {
  it("asks for more games instead of diagnosing below the minimum sample", () => {
    const tasks = buildTrainingTasks([], 4);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].patternTag).toBeNull();
    expect(tasks[0].targetCount).toBe(MIN_SAMPLE_GAMES - 4);
  });

  it("never emits more than three tasks", () => {
    const games = Array.from({ length: 14 }, (_, i) =>
      game(i + 1, ["hanging_piece", "allowed_fork", "time_trouble", "back_rank", "king_safety"], {
        opening: i % 2 === 0 ? "Sicilian Defense" : "French Defense",
      }),
    );
    const tasks = buildTrainingTasks(aggregatePatterns(games), games.length);
    expect(tasks.length).toBeLessThanOrEqual(3);
  });

  it("makes every task measurable", () => {
    const games = Array.from({ length: 14 }, (_, i) =>
      game(i + 1, ["hanging_piece"], {
        opening: i % 2 === 0 ? "Sicilian Defense" : "French Defense",
      }),
    );
    const tasks = buildTrainingTasks(aggregatePatterns(games), games.length);
    for (const task of tasks) {
      expect(task.completionCriteria.length).toBeGreaterThan(0);
      expect(task.targetCount ?? task.targetMinutes).toBeTruthy();
      expect(task.instruction).not.toMatch(/^전술 공부하기$/);
      expect(task.instruction).toContain("근거");
    }
  });
});
