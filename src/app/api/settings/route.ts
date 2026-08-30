import { z } from "zod";
import { locateEngine } from "@/lib/engine/locate";
import { getAllSettings, getSetting, setSetting, SETTING_KEYS } from "@/lib/settings";
import { PRESETS } from "@/lib/analysis/analyzer";
import { fail, handleError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({
      settings: getAllSettings(),
      presets: PRESETS,
      engine: locateEngine(getSetting(SETTING_KEYS.stockfishPath)),
    });
  } catch (err) {
    return handleError(err);
  }
}

const bodySchema = z.object({
  stockfishPath: z.string().nullable().optional(),
  analysisPreset: z.enum(["fast", "standard", "precise"]).optional(),
  threads: z.number().int().min(1).max(16).optional(),
  hashMb: z.number().int().min(16).max(4096).optional(),
  contact: z.string().max(200).optional(),
});

export async function PUT(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("설정 형식이 올바르지 않습니다.");
    const d = parsed.data;
    if (d.stockfishPath !== undefined)
      setSetting(SETTING_KEYS.stockfishPath, d.stockfishPath ?? "");
    if (d.analysisPreset) setSetting(SETTING_KEYS.analysisPreset, d.analysisPreset);
    if (d.threads !== undefined) setSetting(SETTING_KEYS.threads, String(d.threads));
    if (d.hashMb !== undefined) setSetting(SETTING_KEYS.hashMb, String(d.hashMb));
    if (d.contact !== undefined) setSetting(SETTING_KEYS.contact, d.contact);

    return ok({
      settings: getAllSettings(),
      engine: locateEngine(getSetting(SETTING_KEYS.stockfishPath)),
    });
  } catch (err) {
    return handleError(err);
  }
}
