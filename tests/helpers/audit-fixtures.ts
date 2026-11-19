import fs from "node:fs";
import path from "node:path";

const FIXTURE_DIRECTORY = path.resolve(__dirname, "..", "..", "audit", "fixtures");

/** Loads a redacted live response recorded during the audit (audit/fixtures/<name>.json). */
export function loadAuditFixture(fixtureName: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIRECTORY, `${fixtureName}.json`), "utf8"));
}

export function listAuditFixtureNames(): string[] {
  return fs
    .readdirSync(FIXTURE_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".json") && !fileName.startsWith("_"))
    .map((fileName) => fileName.replace(/\.json$/, ""));
}
