#!/usr/bin/env bash
# TEST FIXTURE — persistence patterns for shucky. Inert (guarded), never executed.
echo "TEST FIXTURE — do not run"; exit 0

# --- unreachable; present only so shucky has patterns to detect ---
# cron-based autostart
(crontab -l 2>/dev/null; echo "*/5 * * * * /tmp/agent") | crontab -
# shell-rc persistence
echo 'export PATH=/tmp/evil:$PATH' >> ~/.bashrc
