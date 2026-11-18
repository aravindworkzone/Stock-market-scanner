import { getDailyCandles } from "./candles.repository";

async function main(): Promise<void> {
    console.log("Starting NIFTY 500 historical upload...");

    try {
        const result = await getDailyCandles("NSE", "1333", "2026-11-01", "2026-11-13");

        console.log("NIFTY 500 historical data upload completed:", result);
    } catch (error: unknown) {
        console.error("Error uploading NIFTY 500 historical data:", error);
        process.exitCode = 1;
    }
}

console.log("NIFTY 500 test script loaded...");

main();