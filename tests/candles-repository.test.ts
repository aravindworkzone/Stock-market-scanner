import { describe, expect, it } from "vitest";
import { getLatestCandleDates, normalizeCandleDate, type SqlClient } from "../src/candles/candles.repository.js";

/** Fake tagged-template SQL client: records the query and returns canned rows (no database). */
function buildFakeSqlClient(resultRows: Record<string, unknown>[] | Error) {
  const executedQueries: Array<{ queryText: string; parameters: unknown[] }> = [];
  const sqlClient: SqlClient = async (templateStrings, ...templateValues) => {
    executedQueries.push({ queryText: templateStrings.join("$?"), parameters: templateValues });
    if (resultRows instanceof Error) throw resultRows;
    return resultRows;
  };
  return { sqlClient, executedQueries };
}

describe("getLatestCandleDates", () => {
  it("groups by symbol token, parameterises exchange and tokens, and normalises dates", async () => {
    const { sqlClient, executedQueries } = buildFakeSqlClient([
      { symbol_token: "3045", last_candle_date: new Date("2026-11-18T00:00:00Z") },
      { symbol_token: "2885", last_candle_date: "2026-11-17" },
    ]);
    const latestDates = await getLatestCandleDates("NSE", ["3045", "2885", "1594"], sqlClient);

    expect(Object.fromEntries(latestDates)).toEqual({ "3045": "2026-11-18", "2885": "2026-11-17" });
    expect(executedQueries).toHaveLength(1);
    expect(executedQueries[0].queryText).toMatch(/MAX\(candle_date\)/);
    expect(executedQueries[0].queryText).toMatch(/GROUP BY symbol_token/);
    expect(executedQueries[0].parameters).toEqual(["NSE", ["3045", "2885", "1594"]]);
  });

  it("does not query for an empty token list", async () => {
    const { sqlClient, executedQueries } = buildFakeSqlClient([]);
    expect((await getLatestCandleDates("NSE", [], sqlClient)).size).toBe(0);
    expect(executedQueries).toHaveLength(0);
  });

  it("wraps database failures as [DATABASE_ERROR]", async () => {
    const { sqlClient } = buildFakeSqlClient(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    await expect(getLatestCandleDates("NSE", ["3045"], sqlClient)).rejects.toMatchObject({
      code: "DATABASE_ERROR",
      message: "[DATABASE_ERROR] Failed to read latest candle dates: relation does not exist | Code: 42P01",
    });
  });
});

describe("normalizeCandleDate", () => {
  it("formats Date values in IST and slices strings", () => {
    // A DATE parsed at local IST midnight arrives as the previous day 18:30 UTC.
    expect(normalizeCandleDate(new Date("2026-11-17T18:30:00Z"))).toBe("2026-11-18");
    expect(normalizeCandleDate("2026-11-18T00:00:00.000Z")).toBe("2026-11-18");
  });
});
