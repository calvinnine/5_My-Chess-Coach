import { TAG_BY_ID } from "./tags";
import type { AggregatedPattern } from "./patterns";
import { MIN_SAMPLE_GAMES } from "./patterns";

export interface TrainingTaskDraft {
  patternTag: string | null;
  title: string;
  instruction: string;
  targetCount: number | null;
  targetMinutes: number | null;
  completionCriteria: string;
}

/** How easy each weakness is to fix by changing behaviour, not knowledge. */
const FIXABILITY: Record<string, number> = {
  missed_opponent_threat: 1,
  hanging_piece: 1,
  instant_blunder: 1,
  allowed_mate: 0.9,
  only_move_position: 0.8,
  back_rank: 0.8,
  squandered_advantage: 0.8,
  allowed_fork: 0.7,
  time_trouble: 0.7,
  clock_mismanagement: 0.7,
  missed_mate: 0.6,
  missed_material: 0.6,
  king_safety: 0.6,
  repeated_piece_move: 0.5,
  development_delay: 0.5,
  passive_when_worse: 0.4,
  endgame_technique: 0.4,
};

/**
 * At most three tasks a week, ordered by severity × how fixable the habit is.
 * Every task carries a count, a duration, and a completion test — never
 * "study tactics".
 */
export function buildTrainingTasks(
  patterns: AggregatedPattern[],
  analyzedGameCount: number,
  limit = 3,
): TrainingTaskDraft[] {
  if (analyzedGameCount < MIN_SAMPLE_GAMES) {
    return [
      {
        patternTag: null,
        title: `분석 표본 ${MIN_SAMPLE_GAMES}판 채우기`,
        instruction: `개인 성향을 판단하려면 분석된 게임이 최소 ${MIN_SAMPLE_GAMES}판 필요합니다. 현재 ${analyzedGameCount}판이므로 ${MIN_SAMPLE_GAMES - analyzedGameCount}판을 더 동기화하고 분석하세요.`,
        targetCount: MIN_SAMPLE_GAMES - analyzedGameCount,
        targetMinutes: null,
        completionCriteria: `분석 완료 게임이 ${MIN_SAMPLE_GAMES}판 이상이 됨`,
      },
    ];
  }

  const actionable = patterns
    .filter((p) => p.patternType === "weakness" && p.status !== "observing")
    .map((p) => ({
      pattern: p,
      priority: p.severityScore * (FIXABILITY[p.tag] ?? 0.5) * (p.status === "confirmed" ? 1.2 : 1),
    }))
    .sort(
      (a, b) => b.priority - a.priority || a.pattern.tag.localeCompare(b.pattern.tag),
    )
    .slice(0, limit);

  if (actionable.length === 0) {
    return [
      {
        patternTag: null,
        title: "다음 5게임 사고 체크리스트 적용",
        instruction:
          "확정된 반복 약점이 아직 없습니다. 다음 5게임에서 매 수마다 상대의 체크·잡기·위협을 확인하고, 게임이 끝나면 앱에 당시 생각을 기록하세요.",
        targetCount: 5,
        targetMinutes: null,
        completionCriteria: "래피드 5판을 두고 각 게임에 복기 메모를 남김",
      },
    ];
  }

  return actionable.map(({ pattern }) => {
    const def = TAG_BY_ID[pattern.tag];
    const puzzleCount = pattern.status === "confirmed" ? 20 : 12;
    return {
      patternTag: pattern.tag,
      title: `${pattern.label} 교정`,
      instruction: [
        `근거: 최근 ${pattern.sampleSize}판 중 ${pattern.gameCount}판에서 ${pattern.occurrenceCount}회 발생.`,
        `행동 과제: ${def?.coaching ?? "체크리스트를 적용해 두기"}.`,
        `연습: 하루 15분씩 ${pattern.label} 주제 전술 ${puzzleCount}문제, 그리고 이 약점이 나온 실전 포지션 3개를 다시 계산하기.`,
      ].join(" "),
      targetCount: puzzleCount,
      targetMinutes: 15,
      completionCriteria: `다음 래피드 5판에서 ${pattern.label} 발생 횟수가 ${Math.max(0, Math.floor(pattern.gameCount / 2))}회 이하로 줄어듦`,
    };
  });
}
