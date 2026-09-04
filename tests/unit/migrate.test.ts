import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";

const temporary: string[] = [];

function tempDbPath(): string {
  const file = path.join(os.tmpdir(), `migrate-test-${crypto.randomUUID()}.db`);
  temporary.push(file);
  return file;
}

afterEach(() => {
  for (const file of temporary.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  }
});

describe("applying migrations", () => {
  it("applies every file and records them", async () => {
    const filePath = tempDbPath();
    const location = { label: filePath, filePath, remote: false };

    const first = await runMigrations(location);
    expect(first.sourceAvailable).toBe(true);
    expect(first.ran.length).toBe(first.total);
    expect(first.total).toBeGreaterThan(0);

    // Running again must be a no-op, not a re-application.
    const second = await runMigrations(location);
    expect(second.ran).toEqual([]);
    expect(second.total).toBe(first.total);
  });

  it("reports when the migration files are not there to read", async () => {
    /*
     * Regression: a deployed serverless bundle carries no `drizzle` directory.
     * This used to return "0 applied", which reads exactly like "already up to
     * date" — so a deployment ran against a schema that was never migrated and
     * nothing said so. The failure surfaced only as 500s from a missing column.
     */
    const filePath = tempDbPath();
    const result = await runMigrations(
      { label: filePath, filePath, remote: false },
      "./no-such-directory",
    );

    expect(result.sourceAvailable).toBe(false);
    expect(result.ran).toEqual([]);
    expect(result.total).toBe(0);
  });
});
