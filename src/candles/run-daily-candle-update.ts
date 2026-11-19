/**
 * CLI for the incremental daily-candle updater (cron / Windows Task Scheduler).
 *
 *   npx tsx src/candles/run-daily-candle-update.ts [--dry-run] [--index "NIFTY 500"|"NIFTY 50"]
 *
 * --dry-run  Reads the constituent list and the latest stored dates, prints the plan,
 *            and exits. It never logs in to Angel One and never writes to the database.
 *
 * Exit codes: 0 = completed, 1 = some symbols failed or the run stopped early, 2 = bad arguments / fatal error.
 * Output is a JSON summary without credentials.
 */
import { toAppError } from "../core/errors.js";
import type { IndexName } from "../indices/index-stock.service.js";
import { updateIndexDailyCandles } from "./candles.service.js";

const SUPPORTED_INDEXES: readonly IndexName[] = ["NIFTY 50", "NIFTY 500"];
const DRY_RUN_PLAN_PREVIEW_LIMIT = 20;

export interface DailyCandleUpdateArguments {
  dryRun: boolean;
  indexName: IndexName;
}

/** Accepts `--index "NIFTY 50"`, `--index=NIFTY_50` and `--dry-run`. */
export function parseDailyCandleUpdateArguments(commandLineArguments: string[]): DailyCandleUpdateArguments {
  let dryRun = false;
  let indexName: IndexName = "NIFTY 500";

  for (let argumentIndex = 0; argumentIndex < commandLineArguments.length; argumentIndex++) {
    const currentArgument = commandLineArguments[argumentIndex];
    if (currentArgument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (currentArgument === "--index" || currentArgument.startsWith("--index=")) {
      const rawIndexName =
        currentArgument === "--index" ? commandLineArguments[++argumentIndex] : currentArgument.slice("--index=".length);
      const normalizedIndexName = (rawIndexName ?? "").replace(/_/g, " ").trim().toUpperCase();
      const matchedIndex = SUPPORTED_INDEXES.find((supportedIndex) => supportedIndex === normalizedIndexName);
      if (matchedIndex === undefined) {
        throw new Error(`Unsupported --index "${rawIndexName}". Use one of: ${SUPPORTED_INDEXES.join(", ")}.`);
      }
      indexName = matchedIndex;
      continue;
    }
    throw new Error(`Unknown argument "${currentArgument}". Usage: [--dry-run] [--index "NIFTY 500"]`);
  }
  return { dryRun, indexName };
}

export async function runDailyCandleUpdateCommand(commandLineArguments: string[]): Promise<number> {
  let parsedArguments: DailyCandleUpdateArguments;
  try {
    parsedArguments = parseDailyCandleUpdateArguments(commandLineArguments);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    const summary = await updateIndexDailyCandles(parsedArguments.indexName, { dryRun: parsedArguments.dryRun });
    const printableSummary = {
      ...summary,
      index: parsedArguments.indexName,
      plans: parsedArguments.dryRun ? summary.plans.slice(0, DRY_RUN_PLAN_PREVIEW_LIMIT) : undefined,
      plansShown: parsedArguments.dryRun ? Math.min(summary.plans.length, DRY_RUN_PLAN_PREVIEW_LIMIT) : undefined,
    };
    console.log(JSON.stringify(printableSummary, null, 2));
    return summary.failedStocks.length > 0 || summary.stoppedEarly !== null ? 1 : 0;
  } catch (error: unknown) {
    const appError = toAppError(error);
    console.error(`Daily candle update failed [${appError.code}]: ${appError.message}`);
    return 2;
  }
}

if (require.main === module) {
  void runDailyCandleUpdateCommand(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
