import { z } from "zod";
import {
  AnalysisMismatchError,
  PRESETS,
  rebuildAnalysis,
  type AnalysisSettings,
} from "@/lib/analysis/analyzer";
import { persistAnalysis } from "@/lib/analysis/persist";
import { prepareUploadedEvaluations } from "@/lib/analysis/verify";
import type { Color } from "@/lib/analysis/eval";
import { requireOwnedGame } from "@/lib/auth/ownership";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The browser uploads only what its engine actually measured. Every judgement
 * the app makes — centipawn loss, move grade, themes, turning points — is
 * recomputed here from the PGN this server already stores, so a client cannot
 * grade its own game.
 */
const lineSchema = z.object({
  multipv: z.number().int().min(1).max(8),
  depth: z.number().int().min(0).max(80),
  cp: z.number().int().min(-100_000).max(100_000).nullable(),
  mate: z.number().int().min(-1000).max(1000).nullable(),
  moves: z.array(z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/)).max(64),
});

const bodySchema = z.object({
  engineVersion: z.string().min(1).max(120),
  preset: z.enum(["fast", "standard", "precise"]).optional(),
  evaluations: z
    .array(z.object({ lines: z.array(lineSchema).max(8) }))
    // A game cannot have more plies than this, and the cap bounds the payload.
    .min(1)
    .max(1024),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const gameId = Number(id);
    if (!Number.isInteger(gameId) || gameId <= 0) return fail("게임 번호가 올바르지 않습니다.");

    // Ownership before parsing: the upload is large, and a caller with no
    // claim to this game should never reach the validation of it.
    const { game } = await requireOwnedGame(gameId);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("분석 결과 형식이 올바르지 않습니다.");
    if (game.rules !== "chess") return fail("표준 체스가 아닌 게임은 분석하지 않습니다.");
    if (game.opponentKind !== "human") {
      return fail("코치·봇 연습 게임은 분석 대상이 아닙니다.");
    }

    const settings: AnalysisSettings = PRESETS[parsed.data.preset ?? "standard"];

    try {
      const { problems, evaluations } = prepareUploadedEvaluations(
        game.pgn,
        parsed.data.evaluations,
      );
      if (problems.length > 0) {
        return fail("업로드된 분석이 이 게임과 맞지 않습니다.", 422, { problems });
      }

      const { moves } = rebuildAnalysis(game.pgn, game.playerColor as Color, evaluations);

      await persistAnalysis(gameId, game, {
        moves,
        // Recorded so a browser-produced analysis is distinguishable later.
        engineVersion: `${parsed.data.engineVersion} (browser)`,
        settings,
      });
    } catch (err) {
      if (err instanceof AnalysisMismatchError) return fail(err.message, 422);
      throw err;
    }

    return ok({ saved: true, gameId });
  } catch (err) {
    return handleError(err);
  }
}
