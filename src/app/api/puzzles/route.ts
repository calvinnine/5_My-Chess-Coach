import { z } from "zod";
import { getPuzzles, progressFor, puzzleCountsByTag, recordAttempt } from "@/lib/coaching/puzzle-repo";
import { gradeAttempt } from "@/lib/coaching/puzzles";
import { fail, handleError, ok, optionalPositiveInt } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const playerId = optionalPositiveInt(params, "playerId");
    if (playerId === null) return fail("playerId가 필요합니다.");

    if (params.get("counts") === "1") {
      return ok({ counts: puzzleCountsByTag(playerId) });
    }

    const tag = params.get("tag") ?? undefined;
    const limit = optionalPositiveInt(params, "limit") ?? 10;

    /*
     * The answer never leaves the server before an attempt. Shipping the
     * solution with the position would make the puzzle readable from the
     * network tab, which defeats the exercise; grading returns it instead.
     */
    const puzzles = getPuzzles(playerId, { tag, limit: Math.min(limit, 50) }).map(
      ({ solutionUci, solutionSan, playedSan, bestLine, ...rest }) => {
        void solutionUci;
        void solutionSan;
        void playedSan;
        void bestLine;
        return rest;
      },
    );

    return ok({ puzzles, progress: progressFor(playerId, tag) });
  } catch (err) {
    return handleError(err);
  }
}

const attemptSchema = z.object({
  playerId: z.number().int().positive(),
  puzzleId: z.number().int().positive(),
  tag: z.string().nullable().optional(),
  attemptUci: z.string().min(4).max(5),
});

export async function POST(request: Request) {
  try {
    const parsed = attemptSchema.safeParse(await request.json());
    if (!parsed.success) return fail("풀이 요청 형식이 올바르지 않습니다.");
    const { playerId, puzzleId, tag, attemptUci } = parsed.data;

    // Re-derive the puzzle server-side: the client must not tell us the answer.
    const puzzle = getPuzzles(playerId, { limit: Number.MAX_SAFE_INTEGER }).find(
      (p) => p.id === puzzleId,
    );
    if (!puzzle) return fail("해당 문제를 찾을 수 없습니다.", 404);

    const correct = gradeAttempt(puzzle, attemptUci);
    recordAttempt({
      playerId,
      moveAnalysisId: puzzleId,
      tag: tag ?? null,
      attemptUci,
      correct,
    });

    return ok({
      correct,
      solutionUci: puzzle.solutionUci,
      solutionSan: puzzle.solutionSan,
      playedSan: puzzle.playedSan,
      bestLine: puzzle.bestLine,
      centipawnLoss: puzzle.centipawnLoss,
      gameId: puzzle.gameId,
      ply: puzzle.ply,
      progress: progressFor(playerId, tag ?? undefined),
    });
  } catch (err) {
    return handleError(err);
  }
}
