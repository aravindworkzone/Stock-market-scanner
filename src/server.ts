import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import ServerInfo from "./config/server.config.js";
import searchInstruments from "./instruments/instrument-search.js";
import getHistoricalCandles from "./angelone/historical-candles.js";
import indexStock from "./indices/index-stock.service.js";
import { SMA } from "./calculator/indiactors/SMA.js";
import { EMA } from "./calculator/indiactors/EMA.js";
import { getAllHolding, getPosition, getProfile, getRMS, getHolding } from "./angelone/getAngleone.js";
import RSI from "./calculator/indiactors/RSI.js";
import MACD from "./calculator/indiactors/MACD.js";
import ATR from "./calculator/indiactors/ATR.js";
import SupportResistance from "./calculator/indiactors/SupportResistance.js";
import Week52HighLow from "./calculator/indiactors/Week52HighLow.js";
import VolumeAverage from "./calculator/indiactors/VolumeAverage.js";
import AllIndicators from "./calculator/indiactors/all_Indicator.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "s-market-scanner",
    version: "1.0.0",
  });

  // ==========================================
  // 1. SYSTEM
  // ==========================================

  server.registerTool(
    "ping",
    ServerInfo.health,
    async () => ({
      content: [{ type: "text" as const, text: "pong" }],
    }),
  );

  // ==========================================
  // 2. INSTRUMENT SEARCH
  // ==========================================

  server.registerTool(
    "search_instruments",
    ServerInfo.search_instruments,
    async ({ query, exchange }) => {
      const instruments = await searchInstruments(query, exchange);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(instruments, null, 2),
        }],
      };
    },
  );

  // ==========================================
  // 3. MARKET DATA
  // ==========================================

  server.registerTool(
    "get_historical_candles",
    ServerInfo.get_historical_candles,
    async ({ exchange, symboltoken, interval, fromdate, todate }) => {
      const result = await getHistoricalCandles(
        exchange, symboltoken, interval, fromdate, todate,
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    "get_index_stocks",
    ServerInfo.get_index_stocks,
    async ({ indexName }) => {
      const result = await indexStock(indexName);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            index: indexName,
            totalStocks: result.length,
            stocks: result,
          }, null, 2),
        }],
      };
    },
  );

  // ==========================================
  // 4. TECHNICAL INDICATORS
  // ==========================================

  // 4.1 SMA
  server.registerTool(
    "get_calculator_indicator_sma",
    ServerInfo.calculate_sma,
    async ({ exchange, symboltoken, interval, period, date, direction }) => {
      const result = await SMA(
        exchange, symboltoken, interval, period, date, direction,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.2 EMA
  server.registerTool(
    "get_calculator_indicator_ema",
    ServerInfo.calculate_ema,
    async ({ exchange, symboltoken, interval, period }) => {
      const result = await EMA(exchange, symboltoken, interval, period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.3 RSI
  server.registerTool(
    "calculate_rsi",
    ServerInfo.calculate_rsi,
    async ({ exchange, symboltoken, interval, period }) => {
      const result = await RSI(exchange, symboltoken, interval, period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.4 MACD
  server.registerTool(
    "calculate_macd",
    ServerInfo.calculate_macd,
    async ({ exchange, symboltoken, interval, fastPeriod, slowPeriod, signalPeriod }) => {
      const result = await MACD(
        exchange, symboltoken, interval, fastPeriod, slowPeriod, signalPeriod,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.5 ATR
  server.registerTool(
    "calculate_atr",
    ServerInfo.calculate_atr,
    async ({ exchange, symboltoken, interval, period }) => {
      const result = await ATR(exchange, symboltoken, interval, period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.6 Volume Average
  server.registerTool(
    "calculate_volume_average",
    ServerInfo.calculate_volume_average,
    async ({ exchange, symboltoken, interval, period }) => {
      const result = await VolumeAverage(exchange, symboltoken, interval, period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.7 Support & Resistance
  server.registerTool(
    "calculate_support_resistance",
    ServerInfo.calculate_support_resistance,
    async ({ exchange, symboltoken, interval, lookbackCandles, leftBars, rightBars, tolerancePercent }) => {
      const result = await SupportResistance(
        exchange, symboltoken, interval,
        lookbackCandles, leftBars, rightBars, tolerancePercent,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 4.8 52-Week High & Low
  server.registerTool(
    "get_52_week_high_low",
    ServerInfo.get_52_week_high_low,
    async ({ exchange, symboltoken }) => {
      const result = await Week52HighLow(exchange, symboltoken);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ==========================================
  // 5. COMBINED INDICATORS
  // ==========================================

  server.registerTool(
    "calculate_all_indicators",
    ServerInfo.calculate_all_indicators,
    async ({ exchange, symboltoken, interval, period }) => {
      const result = await AllIndicators(exchange, symboltoken, interval, period);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ==========================================
  // 6. ACCOUNT INFORMATION
  // ==========================================

  // 6.1 Profile
  server.registerTool("get_profile", ServerInfo.get_profile, async () => {
    const result = await getProfile();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  // 6.2 Funds & Margin
  server.registerTool("get_funds_and_margin", ServerInfo.get_funds_and_margin, async () => {
    const result = await getRMS();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  // 6.3 Holdings
  server.registerTool("get_holdings", ServerInfo.get_holdings, async () => {
    const result = await getHolding();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  // 6.4 All Holdings
  server.registerTool("get_all_holdings", ServerInfo.get_all_holdings, async () => {
    const result = await getAllHolding();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  // 6.5 Positions
  server.registerTool("get_positions", ServerInfo.get_positions, async () => {
    const result = await getPosition();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}