# Chess Coach Project Instructions

## Product
- Read `docs/product-spec.md` before changing behavior.
- This is a local-first, single-user chess coaching app.
- The app must work without an LLM API key.
- Never request or store a Chess.com password.

## Architecture
- Keep Chess.com API, PGN parsing, engine analysis, and coaching in separate modules.
- UI components must not calculate chess evaluations.
- Store raw PGN even when parsing or analysis fails.
- All engine evaluations exposed to the app must be normalized to the user's perspective.

## Quality
- Before declaring a task complete, run lint, typecheck, unit tests, and relevant Playwright tests.
- Add regression tests for every analysis bug.
- Do not classify a personal weakness from fewer than 10 analyzed games.
- Every coaching claim must link to evidence games or positions.

## Workflow
- Inspect the existing code and tests before editing.
- For changes spanning more than three modules, present a short implementation plan first.
- Make one phase work end-to-end before starting the next phase.
- Update `docs/decisions.md` when changing architecture or analysis thresholds.

## Practical notes for this repo
- Dev server runs on port 3117; the Playwright suite starts its own on 3178 against `data/e2e.db`.
- `npm run db:migrate` is safe to re-run; the server also migrates on startup.
- Engine tests are skipped automatically when Stockfish is not installed.
- Evaluations are stored in the player's perspective. Only convert to the
  white-positive axis at the UI boundary (`toWhitePerspective`).
- A delivered checkmate is stored as a saturated centipawn score, not `mate: 0`,
  because 0 has no sign and cannot be flipped between perspectives.
