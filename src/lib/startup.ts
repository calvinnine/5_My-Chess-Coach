import "server-only";
import { runMigrations } from "@/db/migrate";
import { resolveLocation } from "@/db/location";
import { recoverStaleJobs } from "@/lib/analysis/job";

/**
 * Runs once when the server process starts.
 *
 * Two jobs: bring the schema up to date before anything touches the database,
 * and clear out analysis rows left in `running` by a previous process that was
 * killed mid-analysis. Nothing is actually running at startup, so any such row
 * is stale and belongs back in the queue.
 */
export async function runStartupTasks() {
  try {
    const { ran, sourceAvailable } = await runMigrations(resolveLocation());
    if (!sourceAvailable) {
      /*
       * A deployed function bundle does not carry the `drizzle` directory, so
       * there is nothing to apply here — the build step owns migrations for a
       * deployment (`postbuild`). Saying so beats reporting "0 applied", which
       * reads identically to "already up to date".
       */
      console.log(
        "[chess-coach] 마이그레이션 파일이 없어 건너뜁니다 (배포에서는 빌드 단계가 적용합니다).",
      );
    } else if (ran.length > 0) {
      console.log(`[chess-coach] 마이그레이션 ${ran.length}건 적용`);
    }
  } catch (err) {
    console.error("[chess-coach] 마이그레이션 실패:", err);
    return;
  }

  try {
    const recovered = await recoverStaleJobs();
    if (recovered > 0) {
      console.log(`[chess-coach] 중단된 분석 ${recovered}건을 대기 상태로 되돌렸습니다.`);
    }
  } catch (err) {
    console.error("[chess-coach] 중단 작업 복구 실패:", err);
  }
}
