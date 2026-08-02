#!/usr/bin/env bash
# Supervisor for the player's snapshot server.
#
# Something in the agent fleet keeps SIGTERMing this — it is not tools/cleanup.sh
# (which explicitly skips port 5200) and there is no pkill against preview servers
# anywhere in tools/, so it is most likely a sub-agent's ad-hoc cleanup in a
# scratch shell. Rather than hand-restart it every time, respawn on exit.
cd "$(dirname "$0")/.." || exit 1
while true; do
  npx vite preview --outDir dist-play --port 5200 --host 127.0.0.1 >/dev/null 2>&1
  # A clean manual stop still exits; a kill gets us straight back up.
  sleep 3
done
