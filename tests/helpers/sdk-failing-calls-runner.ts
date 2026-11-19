/**
 * Child-process runner for tests/sdk-error-log.test.ts (run with `node --import tsx`).
 * Makes three failing SmartAPI SDK calls against a local fake server, fully offline:
 *   1. generateSession -> HTTP 200 {status:false, errorcode:"AB1050"} (login body holds client code/PIN/TOTP)
 *   2. getProfile      -> HTTP 403 "Access denied because of exceeding access rate"
 *   3. getRMS          -> connection refused (network error)
 *
 * SDK_LOG_TEST_MODE:
 *   "protected"   - import sdk-logger before the SDK (production order)
 *   "late"        - load the SDK first, then sdk-logger (fallback path)
 *   "unprotected" - never import sdk-logger (control: proves the SDK really leaks)
 *
 * Prints one JSON line to stdout: { installState, loginResult, profileResult, networkResult }.
 */
import http from "node:http";
import path from "node:path";
import Module from "node:module";
import type { AddressInfo } from "node:net";
import { FAKE_SECRETS } from "./fake-secrets";

type SmartApiConstructor = new (options: Record<string, unknown>) => Record<string, (...callArguments: unknown[]) => Promise<unknown>>;

function stubPublicIpLookup(): void {
  // The SDK constructor fires publicIp.v4() (an outbound lookup). Keep the test offline.
  const sdkEntryPath = require.resolve("smartapi-javascript");
  const publicIpPath = require.resolve("public-ip", { paths: [path.dirname(sdkEntryPath)] });
  const stubModule = new Module(publicIpPath);
  stubModule.filename = publicIpPath;
  stubModule.loaded = true;
  stubModule.exports = { v4: async () => "0.0.0.0", v6: async () => "::" };
  require.cache[publicIpPath] = stubModule;
}

function startFakeBrokerServer(): Promise<http.Server> {
  const fakeServer = http.createServer((request, response) => {
    const requestPath = request.url ?? "";
    if (requestPath.includes("loginByPassword")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: false, message: "Invalid totp", errorcode: "AB1050", data: null }));
      return;
    }
    if (requestPath.includes("getProfile")) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Access denied because of exceeding access rate");
      return;
    }
    response.writeHead(500);
    response.end();
  });
  return new Promise((resolve) => fakeServer.listen(0, "127.0.0.1", () => resolve(fakeServer)));
}

async function findClosedPort(): Promise<number> {
  const probeServer = await startFakeBrokerServer();
  const closedPort = (probeServer.address() as AddressInfo).port;
  await new Promise((resolve) => probeServer.close(resolve));
  return closedPort;
}

async function runFailingCalls(): Promise<void> {
  const testMode = process.env.SDK_LOG_TEST_MODE ?? "protected";
  stubPublicIpLookup();

  let installState = "not-installed";
  if (testMode === "protected") {
    installState = require("../../src/angelone/sdk-logger").sdkLoggerInstallState;
  }
  const { SmartAPI } = require("smartapi-javascript") as { SmartAPI: SmartApiConstructor };
  if (testMode === "late") {
    installState = require("../../src/angelone/sdk-logger").sdkLoggerInstallState;
  }

  const fakeServer = await startFakeBrokerServer();
  const fakeServerPort = (fakeServer.address() as AddressInfo).port;
  const closedPort = await findClosedPort();

  const reachableClient = new SmartAPI({
    api_key: FAKE_SECRETS.apiKey,
    root: `http://127.0.0.1:${fakeServerPort}`,
    access_token: FAKE_SECRETS.jwt,
    timeout: 5000,
  });
  const loginResult = await reachableClient.generateSession(FAKE_SECRETS.clientCode, FAKE_SECRETS.pin, FAKE_SECRETS.totp);
  const profileResult = await reachableClient.getProfile();

  const unreachableClient = new SmartAPI({
    api_key: FAKE_SECRETS.apiKey,
    root: `http://127.0.0.1:${closedPort}`,
    access_token: FAKE_SECRETS.jwt,
    timeout: 5000,
  });
  const networkResult = await unreachableClient.getRMS();

  await new Promise((resolve) => fakeServer.close(resolve));
  // Give winston's async file stream (unprotected/late modes) time to flush.
  await new Promise((resolve) => setTimeout(resolve, 750));

  process.stdout.write(`${JSON.stringify({ installState, loginResult, profileResult, networkResult })}\n`);
}

runFailingCalls().catch((error: unknown) => {
  process.stderr.write(`runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
