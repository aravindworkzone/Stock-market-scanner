// npm run update_candle_nifty_500 [-- --dry-run]
// Incremental NIFTY 500 update (see run-daily-candle-update.ts).
import { runDailyCandleUpdateCommand } from "./run-daily-candle-update.js";

void runDailyCandleUpdateCommand(["--index", "NIFTY 500", ...process.argv.slice(2)]).then((exitCode) => {
  process.exitCode = exitCode;
});
