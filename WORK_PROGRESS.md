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
- [ ] Phase B — Web Worker 분석 경로, 결과 업로드 + 서버 검증
- [ ] Phase C — 다중 사용자 저장소(Turso 우선), 전역 API 큐, 어뷰즈 상한

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

## 다음 할 일

- [x] **전량 분석 완료** (621/628판, 실패 7판)
- [ ] **`openingSpecific` 판정 수정** — 절대 횟수가 아니라 편중도로 (위 "알려진 문제")
- [ ] 관찰 창(`CONFIRMED_WINDOW = 30`) 재검토 — 621판을 분석했는데도 진단은 최근
      30판만 본다. 표본이 늘어도 결론이 안 변하는 이유이며, 전체 기간 뷰가 없다.
- [ ] 타임아웃 실패 7판 재시도 (`analysis_status='failed'` → `pending`)
- [ ] Phase B — Web Worker 분석 경로
- [ ] (선택) Phase 5 LLM 계층
