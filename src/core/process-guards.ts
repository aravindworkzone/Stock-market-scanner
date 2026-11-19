/**
 * Process-level guards. Must not import src/config/config.ts (stdio.ts installs
 * these before .env is loaded).
 *
 * smartapi-javascript's constructor fires `publicIp.v4()` without awaiting or
 * catching it (smartapi-connect.js:47-49). If the lookup fails, Node's default
 * unhandled-rejection mode would crash the server; this guard logs it instead.
 */
import { collectSecretValues, scrubSecretText } from "../angelone/sdk-log-sanitizer.js";

export function describeRejectionReason(rejectionReason: unknown): string {
  const reasonText =
    rejectionReason instanceof Error
      ? `${rejectionReason.name}: ${rejectionReason.message}`
      : typeof rejectionReason === "string"
        ? rejectionReason
        : "non-Error rejection value";
  return scrubSecretText(reasonText, collectSecretValues()).slice(0, 500);
}

export function createUnhandledRejectionListener(
  writeError: (line: string) => void,
): (rejectionReason: unknown) => void {
  return (rejectionReason: unknown) => {
    writeError(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        message: `Unhandled promise rejection (server kept running): ${describeRejectionReason(rejectionReason)}`,
      }),
    );
  };
}

let guardInstalled = false;

/** Installs the listener once. Logs to stderr (safe for the MCP stdio transport). */
export function installUnhandledRejectionGuard(): void {
  if (guardInstalled) {
    return;
  }
  guardInstalled = true;
  process.on("unhandledRejection", createUnhandledRejectionListener((line) => console.error(line)));
}
