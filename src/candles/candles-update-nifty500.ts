import { uploadNifty500HistoricalData } from "./candles.service.js";

async function main(): Promise<void> {
    try {
        const result = await uploadNifty500HistoricalData();

        console.log(
            "NIFTY 500 historical data upload completed:",
            result
        );
    } catch (error: unknown) {
        console.error(
            "Error uploading NIFTY 500 historical data:",
            error
        );

        process.exitCode = 1;
    }
}

main();