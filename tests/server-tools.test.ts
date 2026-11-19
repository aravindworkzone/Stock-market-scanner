import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import { CANDLE_INTERVALS } from "../src/config/candle-intervals.js";

/** The 19 tools that existed before this branch; they must all still be registered unchanged. */
const ORIGINAL_TOOL_NAMES = [
  "ping",
  "search_instruments",
  "get_historical_candles",
  "get_index_stocks",
  "get_calculator_indicator_sma",
  "get_calculator_indicator_ema",
  "calculate_rsi",
  "calculate_macd",
  "calculate_atr",
  "calculate_volume_average",
  "calculate_support_resistance",
  "get_52_week_high_low",
  "calculate_all_indicators",
  "bulk_indicators_scanner",
  "get_profile",
  "get_funds_and_margin",
  "get_holdings",
  "get_all_holdings",
  "get_positions",
];

async function connectClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  const client = new Client({ name: "server-tools-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP tool registry", () => {
  it("still registers every original tool, all read-only", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const registeredNames = tools.map((tool) => tool.name);

    for (const toolName of ORIGINAL_TOOL_NAMES) {
      expect(registeredNames).toContain(toolName);
    }
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    await client.close();
  });

  it("keeps the same interval values in every interval schema", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const intervalSchemas = tools
      .map((tool) => (tool.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.interval)
      .filter((intervalSchema) => intervalSchema !== undefined);

    expect(intervalSchemas).toHaveLength(9);
    for (const intervalSchema of intervalSchemas) {
      expect(intervalSchema?.enum).toEqual([...CANDLE_INTERVALS]);
    }
    await client.close();
  });

  it("ping still answers pong", async () => {
    const client = await connectClient();
    const pingResult = await client.callTool({ name: "ping", arguments: {} });
    expect(pingResult.content).toEqual([{ type: "text", text: "pong" }]);
    await client.close();
  });
});
