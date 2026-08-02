#!/usr/bin/env bash
# Reclaim the machine after a heavy agent session.
#
# Agents drive throwaway headless Chrome instances and Vite servers. When a run
# is killed mid-capture those get orphaned (parent PID 1) and keep burning CPU,
# and the screenshot pile grows fast enough that on-access antivirus scanning
# becomes the dominant load. Both were measured: load average 37 on 8 cores with
# 4.7 GB of captures on disk.
#
# Safe by construction: only touches processes whose parent is launchd (i.e. no
# live script owns them) and capture directories untouched for 2+ hours. Your
# own Chrome is never a match — it is not launched with --headless.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

killed=0
for p in $(pgrep -f "Google Chrome.*--headless" 2>/dev/null; pgrep -f "chrome-headless-shell" 2>/dev/null); do
  [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "1" ] || continue
  kill -TERM "$p" 2>/dev/null && killed=$((killed + 1))
done

vites=0
for p in $(pgrep -f "vite --port" 2>/dev/null; pgrep -f "vite preview" 2>/dev/null); do
  [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "1" ] || continue
  # Never reap the player's own snapshot server on 5200 — it runs detached, so
  # its parent is launchd and it looks exactly like an orphan.
  ps -o command= -p "$p" 2>/dev/null | grep -q -- "--port 5200" && continue
  kill -TERM "$p" 2>/dev/null && vites=$((vites + 1))
done

dirs=0
if [ -d shots ]; then
  for d in shots/*/; do
    b=$(basename "$d")
    # Keep the graded iteration, the deliverables and anything recent.
    case "$b" in iter*|video|e2e|play) continue ;; esac
    [ -n "$(find "$d" -newermt '-120 minutes' -print -quit 2>/dev/null)" ] && continue
    rm -rf "$d" && dirs=$((dirs + 1))
  done
fi

echo "orphaned browsers terminated: $killed"
echo "orphaned vite servers stopped: $vites"
echo "stale capture dirs removed:   $dirs"
echo "shots/ now: $(du -sh shots 2>/dev/null | awk '{print $1}')"
echo "load: $(uptime | sed 's/.*averages: //')"
