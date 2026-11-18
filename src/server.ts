import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import searchInstruments from "./instruments/instrument-search.js";
import getHistoricalCandles from "./angelone/historical-candles.js";
import indexStock from "./indices/index-stock.service.js";

const ServerInfo = {
  search_instruments: {
    title: "Search Instruments",
    description:
      "Search the local Angel One instrument master on NSE or BSE by company name, trading symbol, or exact token. At least one of name, symbol, or token is required; if you give several, all must match. Name and symbol are case-insensitive, ignore spaces ('HDFC BANK' matches 'HDFCBANK'), and allow partial matches. Token must match exactly. Returns up to 'limit' matching instruments plus the total match count, so use a specific query. Call this first to get the exact symbol and symboltoken for other market tools. Read-only; does not place trades or fetch live prices.",
    inputSchema: {
      query: z.object({
        name: z.string().trim().min(1).max(100).optional()
          .describe("Company name, partial allowed, e.g. HDFC BANK"),
        symbol: z.string().trim().min(1).max(100).optional()
          .describe("Trading symbol, partial allowed, e.g. HDFCBANK-EQ"),
        token: z.string().trim().min(1).max(20).optional()
          .describe("Exact Angel One symbol token, e.g. 1333"),
      }),
      exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange to search: NSE or BSE"),
      limit: z.number().int().min(1).max(100).default(20)
        .describe("Maximum results to return, default 20"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
}

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

  server.registerTool("search_instruments", ServerInfo.search_instruments, async ({ query, exchange, limit }) => {
    try {
      const matches = await searchInstruments(query, exchange);
      const result = { totalMatches: matches.length, returned: Math.min(limit, matches.length), instruments: matches.slice(0, limit) };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: "Error occurred while searching instruments :" + error }] };
    }
  });

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

  server.registerTool(
    "get_index_stocks",
    {
      description:
        "Retrieve all matched Angel One instruments belonging to a specified NSE index. Supports NIFTY 50 and NIFTY 500. Returns company name, trading symbol, exchange series, ISIN, and Angel One symbol token. Read-only; does not place trades.",

      inputSchema: {
        indexName: z.enum(["NIFTY 50", "NIFTY 500"])
          .describe("NSE index name: NIFTY 50 or NIFTY 500"),
      },
    },
    async ({ indexName }) => {
      const result = await indexStock(indexName);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                index: indexName,
                totalStocks: result.length,
                stocks: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}