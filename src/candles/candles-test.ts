// Manual smoke run of the NIFTY 500 candle updater. Defaults to --dry-run so it never
// writes to the database by accident; pass --live to really update.
import { runDailyCandleUpdateCommand } from "./run-daily-candle-update.js";

const isLiveRun = process.argv.includes("--live");
const forwardedArguments = process.argv.slice(2).filter((commandLineArgument) => commandLineArgument !== "--live");

void runDailyCandleUpdateCommand([
  "--index",
  "NIFTY 500",
  ...(isLiveRun ? [] : ["--dry-run"]),
  ...forwardedArguments.filter((commandLineArgument) => commandLineArgument !== "--dry-run"),
]).then((exitCode) => {
  process.exitCode = exitCode;
});
