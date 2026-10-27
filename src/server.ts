import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchInstruments } from "./instruments/instrument-repository.js";
import getHistoricalCandles from "./angelone/historical-candles.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "s-market-scanner",
    version: "1.0.0",
  });

  server.registerTool(
      "ping",
      {
          description: "Check whether the MCP server is responding.",
          inputSchema: {},
      },
      async () => ({
          content: [
          {
              type: "text",
              text: "pong",
          },
          ],
      }),
  );

  server.registerTool(
    "search_instruments",
    {
      description:
        "Search the local Angel One instrument master by stock name or trading symbol. Supports NSE and BSE. Returns up to 10 matching instruments. Read-only; does not place trades.",
      inputSchema: {
        query: z.string().trim().min(1).max(100)
          .describe("Stock name or trading symbol, e.g. HDFC BANK"),
        exchange: z.enum(["NSE", "BSE"])
          .describe("Exchange to search: NSE or BSE"),
      },
    },
    async ({ query, exchange }) => {
      const instruments = await searchInstruments(query, exchange, 10);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(instruments, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_historical_candles",
    {
      description:
        "Retrieve historical OHLCV candles from Angel One SmartAPI. Read-only; does not place trades.",
      inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
          .describe("Exchange: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
          .describe("Angel One instrument token, e.g. 1333"),
        interval: z.enum([
          "ONE_MINUTE",
          "THREE_MINUTE",
          "FIVE_MINUTE",
          "TEN_MINUTE",
          "FIFTEEN_MINUTE",
          "THIRTY_MINUTE",
          "ONE_HOUR",
          "ONE_DAY",
        ]).describe("Historical candle interval"),
        fromdate: z.string().min(1)
          .describe("Start date/time in Angel One API format"),
        todate: z.string().min(1)
          .describe("End date/time in Angel One API format"),
      },
    },
    async ({ exchange, symboltoken, interval, fromdate, todate }) => {
      const result = await getHistoricalCandles(
        exchange,
        symboltoken,
        interval,
        fromdate,
        todate,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  return server;
}