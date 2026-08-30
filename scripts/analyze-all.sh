#!/bin/bash
# Drains the pending-analysis queue in batches, one batch at a time.
# Safe to interrupt: each game is committed independently, and a game left
# mid-analysis returns to `pending` on the next server start.
BASE="${BASE:-http://localhost:3117}"
BATCH="${BATCH:-50}"

while true; do
  pending=$(curl -s "$BASE/api/analysis/status" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['queue'].get('pending',0))")
  [ "$pending" -eq 0 ] && { echo "$(date '+%H:%M:%S') 대기열 비었음. 종료."; break; }

  echo "$(date '+%H:%M:%S') 남은 $pending판 — $BATCH판 배치 시작"
  curl -s -X POST "$BASE/api/analyze-batch" -H 'Content-Type: application/json' \
    -d "{\"playerId\":1,\"limit\":$BATCH}" > /dev/null

  # Wait for this batch to finish before queueing the next one.
  while true; do
    sleep 20
    running=$(curl -s "$BASE/api/analysis/status" \
      | python3 -c "import json,sys; print(json.load(sys.stdin)['job']['running'])")
    [ "$running" = "False" ] && break
  done

  done_count=$(curl -s "$BASE/api/analysis/status" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['queue'].get('completed',0))")
  echo "$(date '+%H:%M:%S') 배치 완료 — 누적 분석 $done_count판"
done
