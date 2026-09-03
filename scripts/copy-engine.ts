import fs from "node:fs";
import path from "node:path";
import { wasmFilesFor } from "../src/lib/engine/wasm-node";

/**
 * Puts the browser engine where the page can fetch it.
 *
 * Only `lite-single` is shipped: the multi-threaded builds need cross-origin
 * isolation (COOP/COEP) to use SharedArrayBuffer, and the full net is 113MB
 * against this one's 7MB. See `docs/public-app-plan.md`.
 *
 * The files are generated rather than committed — 7MB of binary does not
 * belong in the repository — so this runs before every build.
 */
const OUT_DIR = path.join(process.cwd(), "public", "engine");

const { js, wasm } = wasmFilesFor("lite-single");
fs.mkdirSync(OUT_DIR, { recursive: true });

let copied = 0;
for (const source of [js, wasm]) {
  const target = path.join(OUT_DIR, path.basename(source));
  const from = fs.statSync(source);
  // Skip an identical copy so repeat builds do not rewrite 7MB every time.
  if (fs.existsSync(target) && fs.statSync(target).size === from.size) continue;
  fs.copyFileSync(source, target);
  copied++;
}

console.log(
  copied
    ? `엔진 파일 ${copied}개를 public/engine/에 복사했습니다.`
    : "엔진 파일이 이미 최신입니다.",
);
