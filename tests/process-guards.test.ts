import { describe, expect, it } from "vitest";
import { createUnhandledRejectionListener, describeRejectionReason } from "../src/core/process-guards.js";

describe("unhandled rejection guard", () => {
  it("logs the SDK publicIp failure instead of crashing", () => {
    const writtenLines: string[] = [];
    const listener = createUnhandledRejectionListener((line) => writtenLines.push(line));
    expect(() => listener(new Error("Couldn't find your IP"))).not.toThrow();
    expect(writtenLines).toHaveLength(1);
    expect(JSON.parse(writtenLines[0])).toMatchObject({
      level: "error",
      message: "Unhandled promise rejection (server kept running): Error: Couldn't find your IP",
    });
  });

  it("scrubs JWTs from the rejection text and tolerates non-Error values", () => {
    expect(describeRejectionReason(new Error("bad token eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ4In0.c2ln"))).toBe(
      "Error: bad token [REDACTED]",
    );
    expect(describeRejectionReason({ any: "object" })).toBe("non-Error rejection value");
    expect(describeRejectionReason("plain text")).toBe("plain text");
  });
});
