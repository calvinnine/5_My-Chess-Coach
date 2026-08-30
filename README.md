# 개인 체스 코치

Chess.com의 내 게임을 자동으로 수집하고 Stockfish로 분석한 뒤, 개별 게임의 승패
원인과 여러 게임에서 반복되는 강점·약점·훈련 과제를 한국어로 설명하는 로컬
단일 사용자 웹앱입니다.

- 게임 기록과 분석 결과는 **이 Mac의 SQLite 파일에만** 저장됩니다.
- Chess.com **비밀번호나 API 키는 필요하지 않고, 요청하지도 않습니다.** 공개
  API(`api.chess.com/pub`)만 사용합니다.
- **LLM API 키 없이 모든 기능이 동작합니다.** 코칭 문장은 규칙 기반으로
  생성됩니다.

## 필요한 것

| 도구 | 확인 |
|---|---|
| Node.js 20 이상 | `node -v` |
| Stockfish | `stockfish` 실행 후 `uci` 입력 |

Stockfish가 없으면:

```bash
brew install stockfish
```

설치하지 않아도 게임 수집·열람은 됩니다. 분석만 비활성화되고, 설정 화면에서
실행 파일 경로를 직접 지정할 수도 있습니다.

## 설치와 실행

```bash
npm install
```

```bash
cp .env.example .env.local
```

`.env.local`의 `CHESS_COACH_CONTACT`에 본인 이메일을 넣어 주세요. Chess.com 공개
API에 보내는 `User-Agent`에 포함되며, 예의 있는 사용을 위한 것입니다.

```bash
npm run db:migrate
```

```bash
npm run dev
```

브라우저에서 <http://localhost:3117> 을 엽니다. 첫 화면에서 Chess.com 사용자명을
입력하면 최근 3개월 중 10판을 가져옵니다.

## 사용 순서

1. **대시보드**에서 사용자명을 등록하고 최근 게임을 가져옵니다.
2. **미분석 10판 분석**을 눌러 Stockfish 분석을 시작합니다. 진행률이 표시되고
   언제든 중지할 수 있습니다.
3. **게임** 목록에서 개별 게임을 열어 보드·평가 그래프·핵심 장면을 확인하고,
   당시 생각과 복기 메모를 남깁니다.
4. 분석이 10판 이상 쌓이면 대시보드가 반복 약점과 이번 주 훈련 과제를 제시합니다.
   그 전까지는 **관찰 중**으로 표시하고 성향을 단정하지 않습니다.

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (포트 3117) |
| `npm run build` / `npm start` | 프로덕션 빌드와 실행 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run test:e2e` | 통합 테스트 (Playwright, 별도 DB·별도 포트) |
| `npm run db:migrate` | 마이그레이션 적용 (반복 실행 안전) |
| `npm run db:backup` | SQLite 백업 파일 생성 |

Stockfish가 설치되어 있지 않으면 엔진이 필요한 단위 테스트는 자동으로
건너뜁니다.

## 데이터 관리

- 데이터베이스: `data/chess-coach.db` (`CHESS_COACH_DB`로 변경 가능)
- 백업: 설정 화면의 **지금 백업** 또는 `npm run db:backup` → `data/backups/`
- 복원: 앱을 종료하고 백업 파일을 `data/chess-coach.db` 위치로 복사
- 내보내기: 설정 화면에서 PGN 전체와 분석 결과 JSON을 받을 수 있습니다

## 동작 방식

```
Chess.com 공개 API → PGN 정규화·저장 → Stockfish 수별 분석
  → 실수·강점 분류 → 여러 게임 패턴 집계 → 코칭 요약·훈련 과제
```

수집과 분석은 분리되어 있습니다. 분석이 실패해도 게임 기록은 남고, 나중에
분석만 다시 시도할 수 있습니다. 분석 도중 앱이 종료되면 다음 실행에서 중단된
작업이 자동으로 대기 상태로 복구됩니다.

### 판정 원칙

- 상대가 둔 수는 평가 흐름에는 쓰지만 **내 실수 통계에는 넣지 않습니다.**
- 이미 승패가 정해진 뒤의 실수를 **패인이라고 부르지 않습니다.**
- 분석 10판 미만에서는 **개인 성향을 확정하지 않습니다.**
- 모든 약점·강점에는 **근거 게임과 장면 링크**가 붙습니다.
- Chess.com의 판정 명칭·아이콘·디자인을 복제하지 않고 자체 용어를 씁니다.

자세한 임계값은 [`docs/analysis-policy.md`](docs/analysis-policy.md)에, 설계
결정과 그 이유는 [`docs/decisions.md`](docs/decisions.md)에 있습니다. 제품
명세 원본은 [`docs/product-spec.md`](docs/product-spec.md)입니다.

## 구조

```
src/
  app/            화면과 API 라우트
  components/     UI 컴포넌트 (평가 계산 로직 없음)
  db/             Drizzle 스키마와 마이그레이션 실행기
  lib/
    chesscom/     공개 API 호출과 응답 검증
    pgn/          PGN 파싱과 정규화
    engine/       Stockfish UCI 통신
    analysis/     수 품질·게임 단계·사건 후보 계산
    coaching/     여러 게임 패턴과 훈련 처방
tests/
  fixtures/       고정 PGN과 API 응답
  unit/           Vitest
  e2e/            Playwright
```

## 아직 없는 것

- Chess.com 로그인이나 비공개 데이터 접근
- 실시간 대국 감시, 수 전송
- 다중 사용자·소셜 기능
- 선택형 LLM 코칭 계층 (설정 화면에 자리만 있고 꺼져 있습니다)
