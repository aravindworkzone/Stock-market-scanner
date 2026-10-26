import { createServer, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { toAppError } from "./errors.js";
import { isAuthorized, rateLimit } from "./auth.js";

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

async function main(): Promise<void> {
  logger.info(`Starting MCP server in ${config.NODE_ENV}`);

  const httpServer = createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== "/mcp") {
      return sendError(res, 404, "Not found");
    }

    const ip = req.socket.remoteAddress ?? "unknown";
    const retryAfter = rateLimit(ip);
    if (retryAfter > 0) {
      logger.warn(`Rate limit exceeded for ${ip}`);
      res.setHeader("Retry-After", String(retryAfter));
      return sendError(res, 429, "Too many requests");
    }

    if (!isAuthorized(req)) {
      logger.warn(`Unauthorized request from ${ip}`);
      return sendError(res, 401, "Unauthorized");
    }

    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error: unknown) {
      const appError = toAppError(error);
      logger.error(`Request failed: ${appError.message}`, appError.code);
      if (!res.headersSent) sendError(res, 500, "Internal server error");
    }
  });

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Port ${config.PORT} is already in use. Stop the other server or set PORT in .env.`, "CONFIGURATION_ERROR");
    } else {
      logger.error(`HTTP server error: ${error.message}`, "INTERNAL_ERROR");
    }
    process.exit(1);
  });

  httpServer.listen(config.PORT, () => {
    logger.info(`MCP server listening on http://localhost:${config.PORT}/mcp`);
  });
}

main().catch((error: unknown) => {
  const appError = toAppError(error);
  logger.error(`Startup failed [${appError.code}]: ${appError.message}`,'CONFIGURATION_ERROR');

  process.exitCode = 1;
});
