#!/usr/bin/env sh
# Incremental daily-candle update for cron.
#
#   scripts/update-daily-candles.sh --dry-run
#   scripts/update-daily-candles.sh --index "NIFTY 500"
#
# Example crontab entry (server clock in IST; 16:15 on weekdays, after the close buffer):
#   15 16 * * 1-5 /path/to/s-market_scanner/scripts/update-daily-candles.sh
#
# Output (JSON summary, no credentials) is appended to logs/candle-update.log.
set -u
cd "$(dirname "$0")/.." || exit 2
mkdir -p logs
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====" >> logs/candle-update.log
npx tsx src/candles/run-daily-candle-update.ts "$@" >> logs/candle-update.log 2>&1
update_exit_code=$?
echo "exit code ${update_exit_code}" >> logs/candle-update.log
exit "${update_exit_code}"
