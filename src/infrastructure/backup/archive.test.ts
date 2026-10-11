import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  backupObjectKey,
  createDataArchive,
  formatBytes,
  selectExpiredBackups,
  shouldSkipBackupEntry,
} from "@/infrastructure/backup/archive";
import { loadBackupConfig, normalizePrefix, r2Endpoint } from "@/infrastructure/backup/config";
import { parseListBucketResult } from "@/infrastructure/backup/r2.client";

describe("backupObjectKey", () => {
  it("builds a dated object key under the prefix", () => {
    const now = new Date("2026-09-04T03:00:00.000Z");
    expect(backupObjectKey("nexus", now)).toBe("nexus/data-2026-09-04T03-00-00Z.tar.gz");
  });

  it("omits a leading slash when the prefix is empty", () => {
    const now = new Date("2026-09-04T03:00:00.000Z");
    expect(backupObjectKey("", now)).toBe("data-2026-09-04T03-00-00Z.tar.gz");
  });
});

describe("shouldSkipBackupEntry", () => {
  it("skips sqlite sidecars and previous archives", () => {
    expect(shouldSkipBackupEntry("nexus.db-wal")).toBe(true);
    expect(shouldSkipBackupEntry("nexus.db-shm")).toBe(true);
    expect(shouldSkipBackupEntry("nexus.db-journal")).toBe(true);
    expect(shouldSkipBackupEntry("data.zip")).toBe(true);
    expect(shouldSkipBackupEntry("nexus.db")).toBe(false);
    expect(shouldSkipBackupEntry("notes")).toBe(false);
  });
});

describe("selectExpiredBackups", () => {
  const cutoff = new Date("2026-09-01T00:00:00.000Z");

  it("keeps recent archives and objects outside the prefix", () => {
    const expired = selectExpiredBackups(
      [
        { key: "nexus/old.tar.gz", lastModified: new Date("2026-08-01T00:00:00.000Z") },
        { key: "nexus/new.tar.gz", lastModified: new Date("2026-09-03T00:00:00.000Z") },
        { key: "data-backups/old.tar.gz", lastModified: new Date("2026-08-01T00:00:00.000Z") },
      ],
      cutoff,
      "nexus",
    );
    expect(expired.map((object) => object.key)).toEqual(["nexus/old.tar.gz"]);
  });
});

describe("loadBackupConfig", () => {
  const r2Env = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "backups",
  };

  it("applies defaults and required R2 fields", () => {
    const config = loadBackupConfig(r2Env);
    expect(config.dataDir).toBe("./data");
    expect(config.prefix).toBe("nexus");
    expect(config.retentionDays).toBe(30);
    expect(config.r2.bucket).toBe("backups");
    expect(r2Endpoint(config.r2)).toBe("https://acct.eu.r2.cloudflarestorage.com");
  });

  it("throws when R2 credentials are missing", () => {
    expect(() => loadBackupConfig({})).toThrow(/R2_ACCOUNT_ID/);
  });

  it("skips R2 validation for dry-run", () => {
    const config = loadBackupConfig({}, { requireR2: false });
    expect(config.r2.bucket).toBe("");
  });

  it("strips slashes from the object prefix", () => {
    expect(normalizePrefix("/nexus/")).toBe("nexus");
  });
});

describe("parseListBucketResult", () => {
  it("extracts objects and a continuation token", () => {
    const xml = `
      <ListBucketResult>
        <IsTruncated>true</IsTruncated>
        <NextContinuationToken>token-2</NextContinuationToken>
        <Contents>
          <Key>nexus/a.tar.gz</Key>
          <LastModified>2026-08-01T00:00:00.000Z</LastModified>
          <Size>12</Size>
        </Contents>
        <Contents>
          <Key>nexus/b.tar.gz</Key>
          <LastModified>2026-08-02T00:00:00.000Z</LastModified>
          <Size>34</Size>
        </Contents>
      </ListBucketResult>
    `;
    const page = parseListBucketResult(xml);
    expect(page.nextContinuationToken).toBe("token-2");
    expect(page.objects).toEqual([
      { key: "nexus/a.tar.gz", lastModified: new Date("2026-08-01T00:00:00.000Z"), size: 12 },
      { key: "nexus/b.tar.gz", lastModified: new Date("2026-08-02T00:00:00.000Z"), size: 34 },
    ]);
  });
});

describe("formatBytes", () => {
  it("renders human-readable sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("createDataArchive", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("snapshots sqlite databases and copies other files into a tar.gz", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-archive-"));
    dirs.push(root);
    const dataDir = path.join(root, "data");
    await mkdir(path.join(dataDir, "notes"), { recursive: true });

    const db = new Database(path.join(dataDir, "nexus.db"));
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('alpha');");
    db.close();

    await writeFile(path.join(dataDir, "notes", "note.txt"), "keep me");
    await writeFile(path.join(dataDir, "nexus.db-wal"), "sidecar");
    await writeFile(path.join(dataDir, "stale.tar.gz"), "skip");

    const archive = await createDataArchive(dataDir, "nexus", new Date("2026-09-04T03:00:00.000Z"));
    dirs.push(path.dirname(archive.archivePath));

    expect(archive.objectKey).toBe("nexus/data-2026-09-04T03-00-00Z.tar.gz");
    expect(archive.sizeBytes).toBeGreaterThan(0);

    const extractDir = path.join(root, "extracted");
    await mkdir(extractDir);
    execFileSync("tar", ["-xzf", archive.archivePath, "-C", extractDir]);

    expect(await readFile(path.join(extractDir, "data", "notes", "note.txt"), "utf8")).toBe("keep me");
    expect(existsSync(path.join(extractDir, "data", "nexus.db-wal"))).toBe(false);
    expect(existsSync(path.join(extractDir, "data", "stale.tar.gz"))).toBe(false);

    const restored = new Database(path.join(extractDir, "data", "nexus.db"), { readonly: true, fileMustExist: true });
    try {
      expect(restored.prepare("SELECT name FROM items").get()).toEqual({ name: "alpha" });
      expect(restored.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    } finally {
      restored.close();
    }

    await archive.cleanup();
  });
});
