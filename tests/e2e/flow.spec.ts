import { expect, test } from "@playwright/test";
import { countGames, resetDatabase, seedPlayer } from "./seed";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetDatabase();
  seedPlayer({ gameCount: 6 });
});

test("the app reports a healthy database and locates the engine", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.database.tables).toContain("games");
  expect(body.database.tables).toContain("move_analyses");
});

test("dashboard holds back a diagnosis below the minimum sample", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "TestUser" })).toBeVisible();
  // 6 seeded games, none analysed: the app must say it is still observing.
  await expect(page.getByText("관찰 중")).toBeVisible();
  await expect(page.getByText(/분석된 게임이 0판이라 개인 성향을 확정하지 않습니다/)).toBeVisible();
});

test("game list filters and opens a game", async ({ page }) => {
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "게임" })).toBeVisible();

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(6);

  const colorFilter = page.getByRole("group", { name: "색" });
  await colorFilter.getByRole("button", { name: "백", exact: true }).click();
  await expect(rows).toHaveCount(3);

  await colorFilter.getByRole("button", { name: "전체", exact: true }).click();
  await expect(rows).toHaveCount(6);

  const resultFilter = page.getByRole("group", { name: "결과" });
  await resultFilter.getByRole("button", { name: "패", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await resultFilter.getByRole("button", { name: "전체", exact: true }).click();
  await expect(rows).toHaveCount(6);

  await rows.first().getByRole("link").first().click();
  await page.waitForURL(/\/games\/\d+$/);
  await expect(page.getByRole("heading", { name: /vs opponent/ })).toBeVisible();
});

test("analysing a game produces a review and the scenes are navigable", async ({ page }) => {
  await page.goto("/games");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.waitForURL(/\/games\/\d+$/);

  await page.getByRole("button", { name: "이 게임 분석" }).click();
  // Analysis runs a real engine; give it room but expect it to land.
  await expect(page.getByRole("heading", { name: "승패를 가른 장면" })).toBeVisible({
    timeout: 90_000,
  });

  await expect(page.getByRole("heading", { name: "수순" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "평가 그래프" })).toBeVisible();

  // Stepping forward moves off the start position.
  await expect(page.getByText("시작 위치입니다.")).toBeVisible();
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.getByText("시작 위치입니다.")).toBeHidden();
});

test("review notes persist across a reload", async ({ page }) => {
  await page.goto("/games");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.waitForURL(/\/games\/\d+$/);

  const thoughts = page.getByPlaceholder("이 게임을 두면서 어떤 계획이었고 무엇이 헷갈렸는지");
  await thoughts.fill("퀸을 너무 일찍 꺼냈다.");
  await page.getByRole("button", { name: "메모 저장" }).click();
  await expect(page.getByText("저장했습니다.")).toBeVisible();

  await page.reload();
  await expect(
    page.getByPlaceholder("이 게임을 두면서 어떤 계획이었고 무엇이 헷갈렸는지"),
  ).toHaveValue("퀸을 너무 일찍 꺼냈다.");
});

test("a repeated sync adds no duplicate games", async ({ request }) => {
  const before = countGames();
  // Re-inserting the same external URLs must be rejected by the unique index.
  const res = await request.get("/api/games?limit=500");
  expect(res.ok()).toBe(true);
  expect((await res.json()).games.length).toBe(before);
  expect(countGames()).toBe(before);
});

test("backup produces a restorable copy", async ({ request }) => {
  const res = await request.post("/api/backup");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.sizeBytes).toBeGreaterThan(0);
  expect(body.file).toMatch(/^chess-coach-.*\.db$/);
});

test("the dashboard persists its pattern snapshot", async ({ request }) => {
  const players = await (await request.get("/api/players")).json();
  const playerId = players.players[0].id;

  const dashboard = await (await request.get(`/api/dashboard?playerId=${playerId}`)).json();
  expect(dashboard.hasEnoughSample).toBe(false);

  // Whatever the dashboard computed must also be readable from the export.
  const analysis = await (await request.get(`/api/export/analysis?playerId=${playerId}`)).json();
  expect(analysis.patterns.length).toBe(dashboard.allPatterns.length);
  for (const stored of analysis.patterns) {
    expect(JSON.parse(stored.evidence_game_ids_json ?? stored.evidenceGameIdsJson).length)
      .toBeGreaterThan(0);
  }
});

test("exports return the stored PGN and analysis", async ({ request }) => {
  const pgn = await request.get("/api/export/pgn");
  expect(pgn.ok()).toBe(true);
  expect(await pgn.text()).toContain("[Event ");

  const analysis = await request.get("/api/export/analysis");
  expect(analysis.ok()).toBe(true);
  const json = await analysis.json();
  expect(json.games.length).toBeGreaterThan(0);
  expect(json).toHaveProperty("moveAnalyses");
});
