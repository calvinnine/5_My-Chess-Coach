import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { resolveLocation } from "../src/db/location";

const location = resolveLocation();
if (location.remote) {
  console.error(
    "호스팅 데이터베이스는 이 스크립트로 백업할 수 없습니다. Turso 쪽 백업을 사용하세요.",
  );
  process.exit(1);
}

const dbPath = location.filePath!;
if (!fs.existsSync(dbPath)) {
  console.error(`데이터베이스가 없습니다: ${dbPath}`);
  process.exit(1);
}

const dir = path.join(path.dirname(dbPath), "backups");
fs.mkdirSync(dir, { recursive: true });
const target = path.join(
  dir,
  `chess-coach-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);

const client = createClient({ url: `file:${dbPath}` });
await client.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
client.close();
console.log(`백업 완료: ${target} (${fs.statSync(target).size} bytes)`);
