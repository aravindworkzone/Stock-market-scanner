@echo off
REM Incremental daily-candle update for Windows Task Scheduler.
REM
REM   scripts\update-daily-candles.cmd --dry-run
REM   scripts\update-daily-candles.cmd --index "NIFTY 500"
REM
REM Schedule it after the market close buffer, e.g. 16:15 IST on weekdays:
REM   schtasks /Create /TN "s-market-scanner candles" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 16:15 ^
REM     /TR "\"%~dp0update-daily-candles.cmd\""
REM
REM Output (JSON summary, no credentials) is appended to logs\candle-update.log.

setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ==== %DATE% %TIME% ==== >> logs\candle-update.log
call npx tsx src\candles\run-daily-candle-update.ts %* >> logs\candle-update.log 2>&1
set UPDATE_EXIT_CODE=%ERRORLEVEL%
echo exit code %UPDATE_EXIT_CODE% >> logs\candle-update.log
exit /b %UPDATE_EXIT_CODE%
