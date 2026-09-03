# My Chess Coach — 작업 진행

Chess.com 게임을 자동 수집하고 로컬 Stockfish로 분석해, 개별 게임의 패인과 여러
게임에 반복되는 습관을 한국어로 설명하는 로컬 단일 사용자 웹앱.

- **저장소**: https://github.com/calvinnine/5_My-Chess-Coach (Private)
- **스택**: Next.js 16 App Router · TypeScript · SQLite/Drizzle · chess.js ·
  react-chessboard · Zod · Recharts · Vitest · Playwright
- **엔진**: Stockfish 18 (Homebrew)
- **명세**: `docs/product-spec.md` · **정책**: `docs/analysis-policy.md` ·
  **결정 기록**: `docs/decisions.md`

---

## Phase 진행 상황

### ✅ Phase 0. 프로젝트 기반
- [x] Next.js·TypeScript 프로젝트 초기화
- [x] SQLite·Drizzle 설정 (9개 테이블, 마이그레이션 2건)
- [x] CLAUDE.md, README, 테스트 환경 구성
- [x] `/api/health` 상태 점검 (DB 경로·테이블 목록·엔진 위치 반환)
- **완료 기준 충족**: 빈 DB 마이그레이션 성공, lint/typecheck/unit 통과

### ✅ Phase 1. Chess.com 동기화
- [x] 프로필·통계·월별 아카이브 클라이언트 (직렬 처리, 지수 백오프, ETag)
- [x] Zod 응답 스키마 (게임 단위 검증 — 한 건 깨져도 나머지 유지)
- [x] 선수 등록과 최근 게임 동기화
- [x] 게임 목록과 필터 (기간·승패·색·시간형식·분석여부·상대유형)
- **완료 기준 충족**: 실제 계정 652판 저장, 재동기화 시 중복 0건, API 실패가 DB를
  손상시키지 않음

### ✅ Phase 2. Stockfish 분석
- [x] UCI 프로세스 래퍼 (MultiPV 2, 취소, 고아 프로세스 방지)
- [x] PGN → ply별 FEN 변환
- [x] 평가값·최선수·PV·centipawn loss 저장
- [x] 진행률, 취소, 재시도, 재시작 시 `running` → `pending` 복구
- **완료 기준 충족**: 고정 PGN 6종 크래시 없이 분석, 양측 관점 테스트 통과

### ✅ Phase 3. 게임 리뷰
- [x] 체스보드, 수순, 평가 그래프 (백 기준 축 + 방향 안내 문구)
- [x] 핵심 장면 선별 (최대 3개, 붕괴 지점 이후 감쇠)
- [x] 규칙 기반 설명 (한 줄 평가·구간별 요약·체크포인트·복기 질문)
- [x] 사용자 당시 생각과 복기 메모 (재분석해도 보존)
- **완료 기준 충족**: 장면 클릭 시 정확한 ply 이동, 패인이 마지막 실수가 아닌 실제
  최대 전환점, 엔진 없이도 저장된 분석 열람 가능

### ✅ Phase 4. 누적 코칭
- [x] 패턴 집계 (10판 미만 확정 금지, 서로 다른 오프닝 2종 이상에서만 확정)
- [x] 강점·약점 대시보드
- [x] 근거 게임 링크 (`/games/:id?ply=N` 딥링크)
- [x] 주간 훈련 과제 (최대 3개, 횟수·시간·완료 기준 포함)
- **완료 기준 충족**: 10판 미만은 "관찰 중", 확정 약점에 근거 장면 3개 이상,
  과제가 측정 가능한 행동으로 표현됨

### ⬜ Phase 5. 선택형 AI 설명
- 의도적으로 미구현. 가이드상 선택 기능이며 API 키가 필요하다.
- 설정 화면에 전송 범위·비용 안내 자리만 마련. 규칙 기반만으로 전 기능 동작.

### ✅ Phase 6. 안정화 (부분)
- [x] 백업·복원 (`VACUUM INTO`, 설정 화면 + `npm run db:backup`)
- [x] E2E 테스트 (Playwright 9종, 프로덕션 빌드 대상, 별도 DB)
- [x] 접근성·반응형 (필터 `role="group"`, 모바일 보드→설명→수순 세로 배치)
- [ ] 대량 게임 분석 성능 점검 — 618판 일괄 분석 미실행

---

## 검증 상태

| 게이트 | 결과 |
|---|---|
| lint | 통과 (0 errors, 0 warnings) |
| typecheck | 통과 |
| unit (Vitest) | 118 passed |
| e2e (Playwright) | 9 passed |
| build | 통과 |

실계정(Calvinnine) 검수: 652판 동기화 · **전량 621판 분석 완료** · 대시보드 진단 확인.

---

## 공개 서비스 전환 (설계 완료, 미착수)

설계: `docs/public-app-plan.md`

핵심 결론 — **브라우저 Stockfish WASM(lite-single)**. 실측 근거:
- WASM lite-single이 네이티브 full보다 **빠름** (0.48s/포지션 vs 0.62s, depth 16).
  작은 NNUE 망을 쓰기 때문.
- 실제 게임 40포지션 대조: 평가 차 중앙값 **13cp**, 90퍼센타일 35cp — 앱의 최소
  임계값(50cp)보다 작아 큰 판단(중대 실수·핵심 장면)은 흔들리지 않음.
- 7MB(전체 빌드는 108MB), COOP/COEP 헤더 불필요.

- [x] **Phase A 완료** — `AnalysisEngine` 인터페이스, `LineEngine` 공통 베이스,
      `WasmEngine` 추가. 판정·코칭 로직 변경 0줄. 테스트 97 → 108개.
      교차 검증: 평가 차 중앙값 < 50cp, 승패 방향 일치 > 90%, 분기점 정확히 일치.
- [x] Phase B — 브라우저 WASM 분석 + 업로드 서버 검증 완료 (2026-09-03)
- [x] Phase C — libSQL 전환 완료 (2026-09-02). 전역 API 큐·어뷰즈 상한은 아직

## 현재 진단 (전량 621판 분석 완료)

628판 중 621판 분석, 7판은 일시적 엔진 타임아웃으로 실패(재시도 가능).
평균 평가 손실 72cp · 중대 실수 2.94/판.

| 확정 약점 | 최근 30판 중 | 오프닝 | 신뢰도 |
|---|---|---|---|
| 포크 허용 | 20판 (28회) | 9종 | 100% |
| 걸린 기물 미확인 | 15판 (28회) | 7종 | 100% |
| 상대 위협 미확인 | 14판 (22회) | 8종 | 100% |

셋 다 뿌리가 같다 — **두기 전에 상대의 수를 보지 않는 습관.**
확정 강점: 정확한 유일수 발견(23판 70회), 위기 방어와 버티기(15판 111회).
계산은 되는데 계산을 시작하기 전 단계가 비어 있다.

### Caro-Kann 가설은 기각됨

전량 분석으로 오프닝별 평균 손실을 비교하니 이전 가설이 틀렸다.

| 오프닝 | 색 | 판 | 승률 | 평균 손실 |
|---|---|---:|---:|---:|
| 기타 | 흑 | 113 | 44% | **78cp** |
| 기타 | 백 | 132 | 55% | 77cp |
| Queens Gambit | 백 | 176 | 59% | 69cp |
| Caro-Kann | 흑 | 107 | 55% | **68cp** |
| Pirc | 흑 | 78 | 55% | 65cp |

**Caro-Kann은 오히려 가장 잘 두는 흑 오프닝이다**(손실 최저 수준, 승률 55%).
흑 승률이 낮은 진짜 원인은 **준비된 레퍼토리 밖의 게임**(기타 흑: 44%, 78cp)이다.
즉 오프닝 지식 문제가 아니라 **준비 범위를 벗어났을 때 계획이 없는 것**에 가깝다.

### 알려진 문제 — 오프닝 특이 판정이 오해를 부른다

대시보드가 세 약점 모두에 "Caro Kann 계열에서 반복" 배지를 붙이는데, 위 데이터와
모순된다. 원인은 `patterns.ts`의 `openingSpecific` 로직:

```ts
[...byOpening.entries()].find(([, count]) => count >= OPENING_SPECIFIC_MIN)
```

- `.find()`라서 **Map 삽입 순서상 첫 번째**를 고른다. 빈도도 편중도도 아니다.
- 절대 횟수만 본다. 최근 30판 중 Caro-Kann이 9판으로 가장 많으니 무조건 걸린다.
- 고치려면 **그 오프닝에서의 발생률 대비 전체 발생률**을 비교해야 한다
  (예: Caro-Kann 9판 중 3판 = 33% vs 전체 30판 중 20판 = 67% → 오히려 덜 나옴).

## 다른 기기에서 이어서 하기

**주의**: 분석 데이터는 git에 없다(`data/*.db`는 .gitignore). 코드만 clone하면
빈 DB에서 시작한다.

1. `git clone https://github.com/calvinnine/5_My-Chess-Coach && npm install`
2. `brew install stockfish`
3. 분석 621판을 옮기려면 `data/backups/chess-coach-*.db` 최신 파일을 대상 기기의
   `data/chess-coach.db`로 복사. **옮기지 않으면 621판을 처음부터 다시 돌려야 한다**
   (약 17시간). 동기화 자체는 1분이면 끝난다.
4. `npm run dev` → http://localhost:3117
5. 새 게임 동기화 후 분석: `caffeinate -i ./scripts/analyze-all.sh`
   (`caffeinate -i`는 필수 — 유휴 절전이 분석을 망친다, D17 참고)
6. 진행 감시가 필요하면 `./scripts/watch-analysis.sh` (종료·정체·서버다운도 잡음)

## 공개 웹서비스 배포 (준비 중)

**목표 주소**: `analyzemychess.vercel.app` (가용 확인 완료 2026-09-02)
`chesscoach` / `mychesscoach` / `mychess` / `my-chess-coach` / `personal-chess-coach`는
전부 선점됨.

### 지금 코드를 그대로 올리면 죽는 것 (코드 확인 완료)

| 문제 | 위치 | 이유 |
|---|---|---|
| 분석 불가 | `lib/engine/uci.ts` | `spawn()`으로 Stockfish 바이너리 실행. 서버리스에 바이너리도 없고 프로세스도 못 띄움 |
| 저장 안 됨 | `db/client.ts` | 로컬 SQLite 파일. Vercel 파일시스템은 읽기 전용·비영속 |
| 백업 실패 | `api/backup` | `VACUUM INTO`가 파일 쓰기 |

**결론: Phase B + C를 끝내기 전에는 배포해도 화면만 뜨는 앱이 된다.**

### Phase C — 저장소 ✅ (2026-09-02 완료)
- [x] `better-sqlite3` 제거, **libSQL 드라이버 하나로 통일**. 로컬은 `file:` URL,
      배포는 `libsql://`. 이중 드라이버는 배포 경로가 처음 실행되는 구조라 버렸다 (D25).
- [x] 마이그레이션 4개 **그대로 재사용됨**(추정이었고, 실제 DB에 적용해 확인). 스키마
      변경 없음.
- [x] 위치 판단을 `src/db/location.ts`로 분리 — `client.ts`가 `server-only`라
      마이그레이션 스크립트가 가져다 쓸 수 없다.
- [x] **동기 데이터 접근 63곳 + 트랜잭션 3곳을 async로 전환** (D26). libSQL은 비동기
      전용이라 드라이버 교체만으로는 안 됐다.
- [x] 백업: 로컬은 `VACUUM INTO` 유지, 원격은 409로 거부 (D27). 사라질 파일을 쓰고
      성공했다고 답하지 않는다.
- [x] lint / typecheck / 단위 172 / E2E 9 통과. 빌드 경고 0
      (기존에 있던 `path.resolve` 동적 경로 경고도 함께 제거).

**실측으로 확인한 libSQL과 better-sqlite3의 차이** (둘 다 기본값이 반대):
- `foreign_keys`: libSQL은 **기본 ON**이고 강제된다 (better-sqlite3는 OFF)
- `journal_mode`: libSQL은 **기본 delete**. WAL은 명시적으로 켜야 한다

**성능**: 3,200행 쓰기가 9ms → 62ms(배치)로 느려지지만, 한 판 분석은 엔진에서만
30~60초다. 판단 기준이 되지 못한다.

**남은 것**: 실제 Turso 데이터베이스 생성은 계정 자격 증명이 필요해 형이 직접 해야 한다.
```
turso db create chess-coach
turso db show chess-coach --url      # → TURSO_DATABASE_URL
turso db tokens create chess-coach   # → TURSO_AUTH_TOKEN
npm run db:migrate                   # 두 값을 넣고 실행하면 원격에 스키마 생성
```

### Phase B — 브라우저 분석 ✅ (2026-09-03 완료)
- [x] `prebuild`/`predev`가 `stockfish-18-lite-single.{js,wasm}`(7MB)만
      `public/engine/`로 복사. git에는 넣지 않음 (`.gitignore`).
- [x] `createBrowserEngine()` 연결 — `src/lib/analysis/browser.ts`. 초기 번들에 들어가지
      않도록 클릭 시점에 동적 import.
- [x] 진행률을 워커 콜백으로 (버튼에 `분석 중… 5/8`)
- [x] **업로드 API + 서버 검증** — 계획을 바꿨다 (D28). 등급을 대조하는 대신
      **클라이언트는 원시 엔진 점수만 올리고 서버가 판정을 전부 다시 계산**한다.
      검증 코드와 판정 코드가 같은 함수라 어긋날 수 없다.
- [x] `CHESS_COACH_DISABLE_LOCAL_ENGINE=1` — 배포 환경에서 자식 프로세스를 막고,
      로컬에서도 브라우저 경로를 시험할 수 있게 (D29)
- [x] lint / typecheck / 단위 186 / E2E 9 통과

**실제 브라우저에서 검증함**: 엔진 없음 상태로 서버를 띄우고 브라우저에서 WASM 분석을
돌려 저장까지 확인. `analysisVersion`에 `Stockfish 18 Lite WASM (browser)`가 기록된다.
조작 시도 3종(개수 불일치·불법 PV·깊이 1) 모두 422로 거부되고 DB는 그대로였다.

## 본인 확인 (공개 서비스 필수)

**요구사항**: 사용자는 **자기 Chess.com 계정만** 분석할 수 있어야 한다. 남의 아이디를
넣어 분석하는 건 막는다. 공개 데이터라 법적 문제는 없더라도, 허용하면 서비스가
무거워지고(어뷰즈·비용·책임) 성격이 달라진다.

### 방법 A — Chess.com OAuth 2.0 (조사 완료 2026-09-02)
**존재한다.** 다만 자동 등록이 아니라 **신청·승인제**다.
- 신청: https://forms.gle/RwGLuZkwDysCj2GV7 (redirect URI 제출 필요)
- 문서: https://chesscom.notion.site/Getting-started-with-Chess-com-OAuth-2-0-Server-5958e57c8c934a3aa7abda2d670969e8
- 취미 프로젝트도 신청 가능하며 파트너 전용이 아님
- client secret은 public client의 경우 선택, **PKCE 권장**
- **위험**: 승인 소요 시간이 공개되어 있지 않고, 커뮤니티 스레드에 "실제로 받은 사람이
  있느냐"는 질문이 있음. 승인이 안 나면 서비스가 막힌다.
- → **배포 주소가 확정된 뒤 먼저 신청해 두고**, 승인을 기다리는 동안 방법 B로 간다.

### 방법 B — 프로필 필드 인증 (폴백, 승인 불필요)
공개 API만으로 소유권을 증명하는 방식:
1. 앱이 일회용 코드 발급 (예: `verify-8f3a2c`)
2. 사용자가 Chess.com 프로필의 **Location** 또는 **Name** 필드에 그 코드를 넣음
3. 앱이 `GET /pub/player/{username}`으로 읽어 일치 확인 → 소유권 증명
4. 확인 후 사용자는 코드를 지워도 됨

장점: 승인 대기 없음, 공개 API만 씀, 구현이 작다.
단점: 사용자가 프로필을 직접 수정해야 함(마찰), 캐시 지연 가능.

**권장**: B를 먼저 구현해 배포하고, A 승인이 나면 "Chess.com으로 로그인" 버튼을
추가해 병행한다. A만 기다리면 배포가 무기한 미뤄진다.

## 개인 맞춤형 서비스로 가기 위해 추가로 필요한 것

지금은 **기능은 개인화돼 있는데 사용자 개념이 없다**. 공개하려면 다음이 필요하다.

- [ ] **세션·소유권 모델** — 지금 `players` 테이블은 있지만 "누가 로그인했는가"가 없다.
      메모(`user_thoughts`)와 퍼즐 기록(`puzzle_attempts`)은 사적인 데이터라 남이 보면
      안 된다. 최소한 세션 쿠키 + 소유자 검사.
- [ ] **API 전역 큐와 쿨다운** — 지금 `ChessComClient`는 인스턴스 단위 직렬화다.
      서버 한 IP에서 여러 사용자 몫을 쏘면 차단된다. 프로세스 전역 큐 + 사용자별
      재동기화 쿨다운(예: 5분) 필요.
- [ ] **어뷰즈 상한** — 1회 동기화 게임 수 상한, 계정당 저장 게임 수 상한,
      분석 결과 업로드 크기 상한.
- [ ] **첫 방문 경험** — 지금은 "10판 미만이면 관찰 중"이라 신규 사용자가 빈 화면을
      본다. 동기화 직후 뭘 보여줄지 설계 필요.
- [ ] **데이터 삭제·내보내기** — 공개 서비스는 사용자가 자기 데이터를 지울 수 있어야
      한다. 내보내기는 이미 있고, 삭제 경로가 없다.
- [ ] **비용 한도** — 분석은 브라우저에서 돌아 서버 CPU는 0이지만, Turso 저장 용량과
      Chess.com API 호출량은 사용자 수에 비례한다.

## 다음 할 일

- [x] 본인 확인 + 세션/소유권 모델 완료 (2026-09-03) → **다음은 전역 API 큐·어뷰즈 상한** → 배포
- [ ] Chess.com OAuth 신청서 제출 (배포 주소 확정 후)
- [ ] 본인 확인 방법 B 구현
- [ ] 타임아웃 실패 7판 재시도 (`analysis_status='failed'` → `pending`)
- [ ] 관찰 창(`CONFIRMED_WINDOW = 30`) 외 전체 기간 뷰 추가
- [ ] (선택) Phase 5 LLM 계층
