import { describe, expect, it } from "vitest";
import {
  inferRepertoire,
  isInRepertoire,
  splitByRepertoire,
  REPERTOIRE_MIN_GAMES,
  REPERTOIRE_MIN_SAMPLE,
  type RepertoireSplitInput,
} from "@/lib/coaching/repertoire";
import { repertoireGapPattern, REPERTOIRE_GAP_MIN_GAMES } from "@/lib/coaching/patterns";

function games(spec: Array<[string | null, "white" | "black", number]>) {
  return spec.flatMap(([openingFamily, playerColor, count]) =>
    Array.from({ length: count }, () => ({ openingFamily, playerColor })),
  );
}

describe("inferring a repertoire from what was played", () => {
  it("says nothing when there are too few games with a colour", () => {
    const repertoire = inferRepertoire(games([["Caro Kann", "black", 10]]));
    expect(repertoire.black.undetermined).toBe(true);
    expect(repertoire.black.prepared).toHaveLength(0);
  });

  it("picks out the openings played often enough to be prepared", () => {
    const repertoire = inferRepertoire(
      games([
        ["Caro Kann", "black", 100],
        ["Pirc Defense", "black", 80],
        ["Scandinavian Defense", "black", 3],
        ["Lion Defense", "black", 5],
      ]),
    );
    const families = repertoire.black.prepared.map((f) => f.family);
    expect(families).toEqual(["Caro Kann", "Pirc Defense"]);
    // Ordered by how often they are played.
    expect(repertoire.black.prepared[0].games).toBe(100);
  });

  it("ignores a family that is frequent in share but tiny in count", () => {
    // 5 of 40 is 12.5% — over the share bar, under the count bar.
    const repertoire = inferRepertoire(
      games([
        ["Main Line", "white", 35],
        ["Rare Line", "white", 5],
      ]),
    );
    expect(repertoire.white.prepared.map((f) => f.family)).toEqual(["Main Line"]);
    expect(REPERTOIRE_MIN_GAMES).toBeGreaterThan(5);
  });

  it("keeps the two colours separate", () => {
    const repertoire = inferRepertoire(
      games([
        ["Queens Gambit", "white", 50],
        ["Caro Kann", "black", 50],
      ]),
    );
    expect(repertoire.white.prepared.map((f) => f.family)).toEqual(["Queens Gambit"]);
    expect(repertoire.black.prepared.map((f) => f.family)).toEqual(["Caro Kann"]);
  });

  it("is deterministic regardless of input order", () => {
    const spec = games([
      ["Caro Kann", "black", 40],
      ["Pirc Defense", "black", 40],
      ["Modern Defense", "black", 20],
    ]);
    const a = inferRepertoire(spec);
    const b = inferRepertoire([...spec].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("classifying a single game", () => {
  const repertoire = inferRepertoire(
    games([
      ["Caro Kann", "black", 100],
      ["Odd Line", "black", 5],
    ]),
  );

  it("recognises a prepared opening", () => {
    expect(
      isInRepertoire(repertoire, { openingFamily: "Caro Kann", playerColor: "black" }),
    ).toBe(true);
  });

  it("recognises a departure", () => {
    expect(
      isInRepertoire(repertoire, { openingFamily: "Odd Line", playerColor: "black" }),
    ).toBe(false);
  });

  it("refuses to judge an unidentified opening", () => {
    /*
     * Null is not "outside". Treating missing opening data as a departure would
     * manufacture a weakness out of a gap in the records.
     */
    expect(
      isInRepertoire(repertoire, { openingFamily: null, playerColor: "black" }),
    ).toBeNull();
  });

  it("refuses to judge a colour it knows nothing about", () => {
    expect(
      isInRepertoire(repertoire, { openingFamily: "Queens Gambit", playerColor: "white" }),
    ).toBeNull();
    expect(repertoire.white.sampleSize).toBeLessThan(REPERTOIRE_MIN_SAMPLE);
  });
});

describe("comparing performance inside and outside the repertoire", () => {
  /*
   * Modelled on the real shape of the data: two main lines plus a long tail of
   * many different rare openings. A single opening played 40 times would not be
   * a departure — it would be part of the repertoire. The tail is what matters.
   */
  const tail: Array<[string, "white" | "black", number]> = Array.from(
    { length: 20 },
    (_, i) => [`Rare ${i}`, "black", 2],
  );
  const repertoire = inferRepertoire(
    games([["Caro Kann", "black", 100], ["Pirc Defense", "black", 60], ...tail]),
  );

  it("treats the long tail as outside and the main lines as inside", () => {
    expect(repertoire.black.prepared.map((f) => f.family)).toEqual([
      "Caro Kann",
      "Pirc Defense",
    ]);
    expect(
      isInRepertoire(repertoire, { openingFamily: "Rare 3", playerColor: "black" }),
    ).toBe(false);
  });

  function split(insideLoss: number, outsideLoss: number) {
    const rows: RepertoireSplitInput[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        openingFamily: "Caro Kann",
        playerColor: "black" as const,
        result: (i % 2 === 0 ? "win" : "loss") as "win" | "loss",
        averageLossCp: insideLoss,
      })),
      ...Array.from({ length: 40 }, (_, i) => ({
        openingFamily: `Rare ${i % 20}`,
        playerColor: "black" as const,
        result: (i % 4 === 0 ? "win" : "loss") as "win" | "loss",
        averageLossCp: outsideLoss,
      })),
    ];
    return splitByRepertoire(repertoire, rows);
  }

  it("measures the gap in both accuracy and score", () => {
    const result = split(65, 85);
    expect(result.inside.games).toBe(40);
    expect(result.outside.games).toBe(40);
    expect(result.lossGapCp).toBe(20);
    expect(result.scoreGap).toBeCloseTo(0.25, 5);
  });

  it("reports a negative gap when the player does better off-repertoire", () => {
    const result = split(85, 65);
    expect(result.lossGapCp).toBe(-20);
  });

  it("skips games it cannot classify", () => {
    const result = splitByRepertoire(repertoire, [
      { openingFamily: null, playerColor: "black", result: "loss", averageLossCp: 900 },
    ]);
    expect(result.inside.games).toBe(0);
    expect(result.outside.games).toBe(0);
  });
});

describe("promoting the gap to a weakness", () => {
  const evidence = Array.from({ length: 6 }, (_, i) => ({
    gameId: i + 1,
    ply: 1,
    moveNumber: 1,
    san: "Odd Line",
    detail: "흑 · Odd Line",
  }));
  const options = {
    sampleSize: 200,
    evidenceGameIds: evidence.map((e) => e.gameId),
    evidence,
    periodStart: 1,
    periodEnd: 2,
  };
  const wide = {
    inside: { games: 60, score: 0.6, averageLossCp: 65 },
    outside: { games: 40, score: 0.4, averageLossCp: 85 },
    lossGapCp: 20,
    scoreGap: 0.2,
  };

  it("reports a clear gap with evidence attached", () => {
    const pattern = repertoireGapPattern(wide, options)!;
    expect(pattern.tag).toBe("out_of_repertoire");
    expect(pattern.patternType).toBe("weakness");
    expect(pattern.evidenceGameIds.length).toBeGreaterThan(0);
    expect(pattern.description).toContain("65cp");
    expect(pattern.description).toContain("85cp");
  });

  it("stays silent when the two sides play the same", () => {
    const pattern = repertoireGapPattern(
      { ...wide, outside: { ...wide.outside, averageLossCp: 66 }, lossGapCp: 1 },
      options,
    );
    expect(pattern).toBeNull();
  });

  it("stays silent when the player is better off-repertoire", () => {
    const pattern = repertoireGapPattern(
      { ...wide, outside: { ...wide.outside, averageLossCp: 50 }, lossGapCp: -15 },
      options,
    );
    expect(pattern).toBeNull();
  });

  it("stays silent on too few off-repertoire games", () => {
    const pattern = repertoireGapPattern(
      { ...wide, outside: { ...wide.outside, games: REPERTOIRE_GAP_MIN_GAMES - 1 } },
      options,
    );
    expect(pattern).toBeNull();
  });

  it("respects the minimum analysed sample like every other weakness", () => {
    expect(repertoireGapPattern(wide, { ...options, sampleSize: 9 })).toBeNull();
  });
});
