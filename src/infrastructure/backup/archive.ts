import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const SQLITE_SIDECARS = [".db-wal", ".db-shm", ".db-journal"];
const ARCHIVE_SUFFIXES = [".tar.gz", ".zip"];

export type DataArchive = {
  archivePath: string;
  sizeBytes: number;
  objectKey: string;
  cleanup: () => Promise<void>;
};

export function isoStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
}

export function backupObjectKey(prefix: string, now: Date): string {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  const filename = `data-${isoStamp(now)}.tar.gz`;
  return normalized ? `${normalized}/${filename}` : filename;
}

export function shouldSkipBackupEntry(name: string): boolean {
  if (SQLITE_SIDECARS.some((suffix) => name.endsWith(suffix))) return true;
  return ARCHIVE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export type ListedBackupObject = {
  key: string;
  lastModified: Date;
};

export function selectExpiredBackups(
  objects: ListedBackupObject[],
  cutoff: Date,
  prefix: string,
): ListedBackupObject[] {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  const keyPrefix = normalized ? `${normalized}/` : "";
  return objects.filter((object) => {
    const isBackup = object.key.startsWith(keyPrefix) && object.key.endsWith(".tar.gz");
    return isBackup && object.lastModified.getTime() < cutoff.getTime();
  });
}

export async function createDataArchive(dataDir: string, prefix: string, now = new Date()): Promise<DataArchive> {
  const absDataDir = path.resolve(dataDir);
  const dataStat = await stat(absDataDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Data directory not found: ${absDataDir}`);
    }
    throw error;
  });
  if (!dataStat.isDirectory()) {
    throw new Error(`BACKUP_DATA_DIR is not a directory: ${absDataDir}`);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "nexus-data-backup-"));
  const snapshotDir = path.join(workDir, "data");
  await mkdir(snapshotDir, { recursive: true });

  try {
    const entries = await readdir(absDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipBackupEntry(entry.name)) continue;
      const source = path.join(absDataDir, entry.name);
      const destination = path.join(snapshotDir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".db")) {
        await snapshotSqlite(source, destination);
      } else {
        await cp(source, destination, { recursive: true, verbatimSymlinks: true });
      }
    }

    const archivePath = path.join(workDir, "archive.tar.gz");
    await runTar(workDir, archivePath);
    const archiveStat = await stat(archivePath);

    return {
      archivePath,
      sizeBytes: archiveStat.size,
      objectKey: backupObjectKey(prefix, now),
      cleanup: () => rm(workDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

async function snapshotSqlite(source: string, destination: string): Promise<void> {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    await db.backup(destination);
  } finally {
    db.close();
  }
}

function runTar(workDir: string, archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-czf", archivePath, "-C", workDir, "data"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`tar exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
