import {
  PERSPECTIVE_LABELS,
  PERSPECTIVE_PHASE,
  TAG_BY_ID,
  type Perspective,
} from "./tags";
import { MIN_SAMPLE_GAMES, type AggregatedPattern } from "./patterns";
import type { RepertoireSplit } from "./repertoire";

export const PERSPECTIVE_ORDER: Perspective[] = [
  "opening",
  "tactics",
  "strategy",
  "endgame",
  "habit",
];

export interface PhaseAccuracy {
  plies: number;
  averageLossCp: number;
  blunders: number;
  mistakes: number;
  /** Share of all the player's blunders that happened in this phase. */
  blunderShare: number;
  blundersPerGame: number;
}

export interface PerspectiveReport {
  perspective: Perspective;
  label: string;
  /** One sentence a person can act on, not a statistic. */
  headline: string;
  phase: "opening" | "middlegame" | "endgame" | null;
  accuracy: PhaseAccuracy | null;
  weaknesses: AggregatedPattern[];
  strengths: AggregatedPattern[];
  /** Concrete drills for this perspective, most important first. */
  drills: string[];
  /** True when there is not enough analysed material to say anything. */
  observing: boolean;
}

export interface CurriculumInput {
  analyzedGames: number;
  patterns: AggregatedPattern[];
  phaseAccuracy: Record<"opening" | "middlegame" | "endgame", PhaseAccuracy | null>;
  repertoireSplit: RepertoireSplit | null;
}

export interface Curriculum {
  observing: boolean;
  minSample: number;
  analyzedGames: number;
  /** The perspective to spend this week on, and why. */
  priority: { perspective: Perspective; label: string; reason: string } | null;
  reports: PerspectiveReport[];
}

function severityOf(patterns: AggregatedPattern[]) {
  return patterns.reduce((sum, p) => sum + p.severityScore, 0);
}

/**
 * Splits the coaching picture into the four parts of a chess game plus the
 * habits that belong to none of them.
 *
 * This does not compute anything new: every number already exists in the
 * per-move analysis and the aggregated patterns. What it adds is the grouping a
 * player actually trains by — nobody practises "severity rank 2".
 */
export function buildCurriculum(input: CurriculumInput): Curriculum {
  const { analyzedGames, patterns, phaseAccuracy, repertoireSplit } = input;
  const observing = analyzedGames < MIN_SAMPLE_GAMES;

  const reports = PERSPECTIVE_ORDER.map<PerspectiveReport>((perspective) => {
    const phase = PERSPECTIVE_PHASE[perspective];
    const belongs = (p: AggregatedPattern) =>
      TAG_BY_ID[p.tag]?.perspective === perspective;

    const weaknesses = patterns
      .filter((p) => p.patternType === "weakness" && belongs(p))
      .sort((a, b) => b.severityScore - a.severityScore || a.tag.localeCompare(b.tag));
    const strengths = patterns
      .filter((p) => p.patternType === "strength" && belongs(p))
      .sort((a, b) => b.severityScore - a.severityScore || a.tag.localeCompare(b.tag));

    const accuracy = phase ? phaseAccuracy[phase] : null;

    return {
      perspective,
      label: PERSPECTIVE_LABELS[perspective],
      phase,
      accuracy,
      weaknesses,
      strengths,
      headline: headlineFor(perspective, weaknesses, strengths, accuracy, repertoireSplit, observing),
      drills: drillsFor(perspective, weaknesses, repertoireSplit),
      observing,
    };
  });

  const ranked = [...reports]
    .filter((r) => r.weaknesses.length > 0)
    .sort(
      (a, b) =>
        severityOf(b.weaknesses) - severityOf(a.weaknesses) ||
        a.perspective.localeCompare(b.perspective),
    );

  const top = ranked[0];
  const priority =
    observing || !top
      ? null
      : {
          perspective: top.perspective,
          label: top.label,
          reason:
            `확정·후보 약점 ${top.weaknesses.length}개가 여기 몰려 있습니다` +
            (top.accuracy
              ? ` (이 구간 평균 손실 ${top.accuracy.averageLossCp}cp, 전체 중대 실수의 ${(top.accuracy.blunderShare * 100).toFixed(0)}%).`
              : "."),
        };

  return { observing, minSample: MIN_SAMPLE_GAMES, analyzedGames, priority, reports };
}

function headlineFor(
  perspective: Perspective,
  weaknesses: AggregatedPattern[],
  strengths: AggregatedPattern[],
  accuracy: PhaseAccuracy | null,
  repertoireSplit: RepertoireSplit | null,
  observing: boolean,
): string {
  if (observing) {
    return `분석된 게임이 ${MIN_SAMPLE_GAMES}판 미만이라 아직 판단하지 않습니다.`;
  }

  if (perspective === "opening" && repertoireSplit && repertoireSplit.outside.games > 0) {
    const inside = repertoireSplit.inside;
    const outside = repertoireSplit.outside;
    if (repertoireSplit.lossGapCp !== null && repertoireSplit.lossGapCp >= 6) {
      return (
        `오프닝 자체보다 **어떤 오프닝이냐**가 문제입니다. 주력 오프닝에서는 ` +
        `${(inside.score * 100).toFixed(0)}%(${inside.averageLossCp}cp)인데 그 밖에서는 ` +
        `${(outside.score * 100).toFixed(0)}%(${outside.averageLossCp}cp)입니다.`
      );
    }
    return `주력 오프닝 안팎의 성적 차이가 크지 않습니다. 오프닝은 급한 구간이 아닙니다.`;
  }

  if (weaknesses.length === 0) {
    const good = strengths.length > 0 ? ` 오히려 ${strengths[0].label}이(가) 강점으로 잡힙니다.` : "";
    return accuracy
      ? `이 구간에서 확정된 약점이 없습니다 (평균 손실 ${accuracy.averageLossCp}cp).${good}`
      : `이 구간에서 확정된 약점이 없습니다.${good}`;
  }

  const top = weaknesses[0];
  if (accuracy) {
    return (
      `가장 큰 문제는 ${top.label}입니다. 이 구간은 내가 둔 수의 평균 손실이 ` +
      `${accuracy.averageLossCp}cp이고, 전체 중대 실수의 ${(accuracy.blunderShare * 100).toFixed(0)}%가 여기서 나옵니다.`
    );
  }
  return `가장 큰 문제는 ${top.label}입니다.`;
}

function drillsFor(
  perspective: Perspective,
  weaknesses: AggregatedPattern[],
  repertoireSplit: RepertoireSplit | null,
): string[] {
  const drills: string[] = [];

  // The tag's own coaching line is the most specific thing available.
  for (const weakness of weaknesses.slice(0, 3)) {
    const coaching = TAG_BY_ID[weakness.tag]?.coaching;
    if (coaching && !drills.includes(coaching)) drills.push(coaching);
  }

  if (
    perspective === "opening" &&
    repertoireSplit &&
    repertoireSplit.lossGapCp !== null &&
    repertoireSplit.lossGapCp >= 6
  ) {
    drills.push(
      `주력 밖 오프닝이 나온 최근 게임 3판을 열어, 처음으로 "모르겠다"고 느낀 수를 표시하고 그 지점의 계획을 한 문장으로 적기`,
    );
  }

  if (drills.length === 0) {
    drills.push("이 구간은 유지 상태입니다. 지금 방식을 그대로 이어가세요.");
  }
  return drills;
}
