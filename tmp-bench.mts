import { createClient } from "@libsql/client";
import path from "node:path";
import { Chess } from "chess.js";
import { parsePgn } from "./src/lib/pgn/parse";
import { positionsOf } from "./src/lib/analysis/analyzer";
import { createNodeWasmEngine } from "./src/lib/engine/wasm-node";

const depth = Number(process.argv[2] ?? 16);
const multiPv = Number(process.argv[3] ?? 2);

const c = createClient({ url: `file:${path.resolve("./data/chess-coach.db")}` });
const r = await c.execute(`
  SELECT g.pgn FROM games g JOIN move_analyses m ON m.game_id = g.id
  WHERE g.analysis_status='completed' AND g.rules='chess'
  GROUP BY g.id HAVING count(m.id) BETWEEN 70 AND 90 LIMIT 1`);
c.close();
const parsed = parsePgn(String(r.rows[0].pgn));
const fens = positionsOf(parsed).filter((f) => !new Chess(f).isGameOver());
const step = Math.max(1, Math.floor(fens.length / 5));
const sample = fens.filter((_, i) => i % step === 0).slice(0, 5);
console.error(`[준비] ${fens.length}포지션 중 ${sample.length}개 표본, d${depth} mpv${multiPv}`);

const engine = createNodeWasmEngine("lite-single", { hashMb: 64, multiPv });
await engine.start();
console.error("[엔진 시작됨]", engine.versionName);
const t0 = performance.now();
for (const fen of sample) await engine.evaluate(fen, { depth });
const per = (performance.now() - t0) / sample.length;
await engine.stop();
console.log(`RESULT d${depth} mpv${multiPv}  포지션당 ${per.toFixed(0)}ms  한 판(${fens.length}포지션) ${((per * fens.length) / 1000).toFixed(0)}초`);
process.exit(0);
