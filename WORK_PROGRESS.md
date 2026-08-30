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
| unit (Vitest) | 108 passed |
| e2e (Playwright) | 9 passed |
| build | 통과 |

실계정(Calvinnine) 검수: 652판 동기화 · 래피드 10판 분석 · 대시보드 생성까지 확인.

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
- [ ] Phase B — Web Worker 분석 경로, 결과 업로드 + 서버 검증
- [ ] Phase C — 다중 사용자 저장소(Turso 우선), 전역 API 큐, 어뷰즈 상한

## 다음 할 일

- [ ] 남은 실전 599판 일괄 분석 진행 중 (`scripts/analyze-all.sh` 백그라운드)
- [ ] 100판 이상 분석 후 패턴 신뢰도 재확인 (현재 표본 25판)
- [ ] (선택) Phase 5 LLM 계층
