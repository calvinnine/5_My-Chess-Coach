import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: every browser-side caller hard-coded "standard", so the analysis
 * strength chosen in settings did nothing. On a deployment the browser is the
 * only engine, which made it the only control over how long an analysis takes —
 * and it was inert.
 */
const originalFetch = globalThis.fetch;

function respondWith(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("the analysis strength the visitor chose", () => {
  it("uses the stored preset", async () => {
    respondWith({ settings: { analysis_preset: "fast" } });
    const { loadAnalysisPreset } = await import("@/lib/analysis/browser");
    expect(await loadAnalysisPreset()).toBe("fast");
  });

  it("passes through every valid preset", async () => {
    const { loadAnalysisPreset } = await import("@/lib/analysis/browser");
    for (const preset of ["fast", "standard", "precise"]) {
      respondWith({ settings: { analysis_preset: preset } });
      expect(await loadAnalysisPreset()).toBe(preset);
    }
  });

  it("falls back to standard when nothing is stored", async () => {
    respondWith({ settings: {} });
    const { loadAnalysisPreset } = await import("@/lib/analysis/browser");
    expect(await loadAnalysisPreset()).toBe("standard");
  });

  it("ignores a value that is not a preset", async () => {
    // A stored typo must not reach PRESETS and produce an undefined config.
    respondWith({ settings: { analysis_preset: "turbo" } });
    const { loadAnalysisPreset } = await import("@/lib/analysis/browser");
    expect(await loadAnalysisPreset()).toBe("standard");
  });

  it("still analyses when settings cannot be read", async () => {
    respondWith({ error: "nope" }, false);
    const { loadAnalysisPreset } = await import("@/lib/analysis/browser");
    expect(await loadAnalysisPreset()).toBe("standard");
  });
});
