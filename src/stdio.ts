console.error("[DEBUG] s-market-scanner stdio.ts loaded");
import dotenv from "dotenv";
import { installUnhandledRejectionGuard } from "./core/process-guards.js";
import { ENV_FILE_PATH } from "./config/paths.js";

// The SDK's unawaited publicIp.v4() lookup must not be able to crash the server.
installUnhandledRejectionGuard();

// Project-root .env, independent of the cwd the MCP client launches us from.
dotenv.config({ path: ENV_FILE_PATH, quiet: true });

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
  const { logger } = await import("./core/logger.js");
  const { toAppError } = await import("./core/errors.js");

  const appError = toAppError(error);

  logger.error(
    `Startup failed [${appError.code}]: ${appError.message}`,
    appError.code,
  );

  process.exitCode = 1;
});