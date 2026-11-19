/**
 * Filesystem locations, resolved from the project root (never the process cwd and
 * never a hard-coded machine path). Must not import config.ts: stdio.ts and config.ts
 * use it before the environment is validated.
 */
import path from "node:path";

/** src/config -> project root. */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/** Resolves an absolute path, or a path relative to the project root. */
export function resolveFromProjectRoot(configuredPath: string): string {
  return path.resolve(PROJECT_ROOT, configuredPath);
}

export const ENV_FILE_PATH = path.join(PROJECT_ROOT, ".env");

/** Data directory: DATA_DIR (absolute or project-relative) or <project root>/data. */
export function resolveDataDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredDirectory = environment.DATA_DIR?.trim();
  return configuredDirectory ? resolveFromProjectRoot(configuredDirectory) : path.join(PROJECT_ROOT, "data");
}

export function resolveInstrumentMasterFile(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDirectory(environment), "instruments", "OpenAPIScripMaster.json");
}

export function resolveConstituentCacheDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDirectory(environment), "constituents");
}
