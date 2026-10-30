console.error("[DEBUG] s-market-scanner stdio.ts loaded");
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(
    "C:/Users/77529/Desktop/manage/s-market_scanner/.env",
  ),
});

async function main(): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { createMcpServer } = await import("./server.js");

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(async (error: unknown) => {
  const { logger } = await import("./logger.js");
  const { toAppError } = await import("./errors.js");

  const appError = toAppError(error);

  logger.error(
    `Startup failed [${appError.code}]: ${appError.message}`,
    appError.code,
  );

  process.exitCode = 1;
});