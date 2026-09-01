#!/bin/bash
# Emits exactly one line when the analysis run reaches a terminal state, then
# exits. Covers the failure modes too: silence here must not be mistaken for
# "still working".
BASE="${BASE:-http://localhost:3117}"
INTERVAL="${INTERVAL:-300}"
STALL_LIMIT="${STALL_LIMIT:-6}"   # consecutive polls with no progress

pending() {
  curl -s -m 10 "$BASE/api/analysis/status" 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['queue'].get('pending',0))" 2>/dev/null
}

last=""
stalls=0
while true; do
  sleep "$INTERVAL"

  p=$(pending)

  if ! pgrep -f analyze-all.sh >/dev/null 2>&1; then
    if [ "$p" = "0" ]; then
      echo "DONE 분석 완료 — 대기 0판"
    else
      echo "STOPPED 배치 스크립트가 종료됨 — 대기 ${p:-알수없음}판"
    fi
    break
  fi

  if [ -z "$p" ]; then
    echo "UNREACHABLE 서버가 응답하지 않음 — 개발 서버가 죽었을 수 있음"
    break
  fi

  if [ "$p" = "$last" ]; then
    stalls=$((stalls + 1))
  else
    stalls=0
  fi

  if [ "$stalls" -ge "$STALL_LIMIT" ]; then
    echo "STALL $((INTERVAL * STALL_LIMIT / 60))분간 진행 없음 — 대기 ${p}판에서 멈춤"
    break
  fi

  last="$p"
done
