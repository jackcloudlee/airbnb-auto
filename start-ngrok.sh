#!/bin/bash
# ngrok 시작 전 인터넷 연결 대기

echo "[ngrok-wrapper] 인터넷 연결 확인 중..."

MAX_WAIT=120  # 최대 2분 대기
WAITED=0

while ! curl -sf --max-time 5 https://ngrok.com > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "[ngrok-wrapper] 인터넷 연결 대기 시간 초과 (${MAX_WAIT}초). 그냥 시작 시도..."
    break
  fi
  echo "[ngrok-wrapper] 인터넷 없음, 5초 후 재시도... (${WAITED}초 경과)"
  sleep 5
  WAITED=$((WAITED + 5))
done

echo "[ngrok-wrapper] 인터넷 연결됨. ngrok 시작."
exec ngrok http 8787 --domain=dirk-nonspottable-eruptively.ngrok-free.dev
