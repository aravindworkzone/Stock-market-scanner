import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { FAKE_SECRETS } from "./helpers/fake-secrets.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RUNNER_PATH = path.join(__dirname, "helpers", "sdk-failing-calls-runner.ts");
const TSX_LOADER_URL = pathToFileURL(path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
const temporaryDirectories: string[] = [];

interface RunnerOutcome {
  workingDirectory: string;
  safeLogFilePath: string;
  output: {
    installState: string;
    loginResult: Record<string, unknown>;
    profileResult: Record<string, unknown>;
    networkResult: unknown;
  };
}

/** Runs the failing SDK calls in a fresh process whose cwd is an empty temp directory. */
function runFailingSdkCalls(testMode: "protected" | "late" | "unprotected"): RunnerOutcome {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `sdk-log-${testMode}-`));
  temporaryDirectories.push(workingDirectory);
  const safeLogDirectory = path.join(workingDirectory, "safe-logs");

  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, SDK_LOG_TEST_MODE: testMode, SMARTAPI_LOG_DIR: safeLogDirectory };
  // Never let real credentials from the developer's shell reach the child.
  for (const environmentKey of ["ANGELONE_API_KEY", "ANGELONE_CLIENT_CODE", "ANGELONE_PIN", "ANGELONE_TOTP_SECRET"]) {
    delete childEnvironment[environmentKey];
  }

  const childResult = spawnSync(process.execPath, ["--import", TSX_LOADER_URL, RUNNER_PATH], {
    cwd: workingDirectory,
    env: childEnvironment,
    encoding: "utf8",
    timeout: 25_000,
  });
  if (childResult.status !== 0) {
    throw new Error(`runner exited ${childResult.status}: ${childResult.stderr}`);
  }
  const lastOutputLine = childResult.stdout.trim().split(/\r?\n/).pop() ?? "{}";
  return {
    workingDirectory,
    safeLogFilePath: path.join(safeLogDirectory, "smartapi-errors.log"),
    output: JSON.parse(lastOutputLine),
  };
}

function expectNoFakeSecrets(logText: string): void {
  for (const secretValue of Object.values(FAKE_SECRETS)) {
    expect(logText).not.toContain(secretValue);
  }
}

afterAll(() => {
  for (const temporaryDirectory of temporaryDirectories) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("SmartAPI SDK error logging", () => {
  it("control: without sdk-logger the SDK writes secrets to ./error.log", () => {
    const outcome = runFailingSdkCalls("unprotected");
    const leakedLogPath = path.join(outcome.workingDirectory, "error.log");
    expect(fs.existsSync(leakedLogPath)).toBe(true);
    expect(fs.readFileSync(leakedLogPath, "utf8")).toContain(FAKE_SECRETS.apiKey);
  });

  it("with sdk-logger loaded first, ./error.log is never created after failing calls", () => {
    const outcome = runFailingSdkCalls("protected");

    expect(outcome.output.installState).toBe("replaced-before-load");
    expect(outcome.output.loginResult).toMatchObject({ status: false, errorcode: "AB1050" });
    expect(outcome.output.profileResult).toMatchObject({ status: 403 });
    expect(outcome.output.networkResult).toEqual({});

    expect(fs.existsSync(path.join(outcome.workingDirectory, "error.log"))).toBe(false);
    expect(fs.readdirSync(outcome.workingDirectory)).toEqual(["safe-logs"]);

    const safeLogText = fs.readFileSync(outcome.safeLogFilePath, "utf8");
    const safeLogRecords = safeLogText.trim().split("\n").map((logLine) => JSON.parse(logLine));
    expect(safeLogRecords).toHaveLength(3);
    expect(safeLogRecords[0]).toMatchObject({ urlPath: "/rest/auth/angelbroking/user/v1/loginByPassword", brokerErrorCode: "AB1050" });
    expect(safeLogRecords[1]).toMatchObject({ httpStatus: 403, brokerMessage: "Access denied because of exceeding access rate" });
    expect(safeLogRecords[2]).toMatchObject({ urlPath: "/rest/secure/angelbroking/user/v1/getRMS", networkErrorCode: "ECONNREFUSED" });
    expectNoFakeSecrets(safeLogText);
  });

  it("fallback: if the SDK loaded first, ./error.log stays free of secrets", () => {
    const outcome = runFailingSdkCalls("late");
    expect(outcome.output.installState).toBe("patched-after-load");

    const leakedLogPath = path.join(outcome.workingDirectory, "error.log");
    if (fs.existsSync(leakedLogPath)) {
      expect(fs.readFileSync(leakedLogPath, "utf8")).toBe("");
    }
    const safeLogText = fs.readFileSync(outcome.safeLogFilePath, "utf8");
    expect(safeLogText.trim().split("\n")).toHaveLength(3);
    expectNoFakeSecrets(safeLogText);
  });
});
