import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Production SQLite directory. Dev scripts set `DATA_DIR` to `./data-dev`. */
export const DEFAULT_DATA_DIR = "./data";

export function dataDir(env: NodeJS.Dict<string> = process.env): string {
  const configured = env.DATA_DIR?.trim();
  return configured ? configured : DEFAULT_DATA_DIR;
}

/** Creates the SQLite directory if needed and returns its path. */
export function ensureDataDir(env: NodeJS.Dict<string> = process.env): string {
  const dir = dataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sqlitePath(filename: string, env: NodeJS.Dict<string> = process.env): string {
  return join(dataDir(env), filename);
}
