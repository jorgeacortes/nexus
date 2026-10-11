/**
 * Compress `data/` (the SQLite snapshot plus other files) and upload the archive to Cloudflare R2.
 *
 * Usage:
 *   pnpm backup:data
 *   pnpm backup:data -- --dry-run
 *   scripts/backup-data.sh
 *
 * Cron (03:10 daily), on the host checkout that owns ./data:
 *   10 3 * * * /home/sandbox/ws/biznagatec-ws/nexus/scripts/backup-data.sh >> /home/sandbox/.logs/nexus-backup.log 2>&1
 */

import { createDataArchive, formatBytes, selectExpiredBackups } from "@/infrastructure/backup/archive";
import { loadBackupConfig } from "@/infrastructure/backup/config";
import { R2Client } from "@/infrastructure/backup/r2.client";

function loadEnvFileQuiet(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: backup-data [--dry-run]\n  --dry-run  Create the archive locally and skip the R2 upload.");
      process.exit(0);
    }
    throw new Error(`Unknown argument '${arg}' (supported: --dry-run)`);
  }
  return { dryRun };
}

async function main(): Promise<void> {
  loadEnvFileQuiet(".env.local");
  const { dryRun } = parseArgs(process.argv.slice(2));
  const config = loadBackupConfig(process.env, { requireR2: !dryRun });
  const startedAt = Date.now();

  console.log(`[backup] snapshotting ${config.dataDir}`);
  const archive = await createDataArchive(config.dataDir, config.prefix);
  console.log(`[backup] archive ${formatBytes(archive.sizeBytes)} → ${archive.objectKey}`);

  try {
    if (dryRun) {
      console.log(`[backup] dry-run: archive kept at ${archive.archivePath}`);
      console.log("[backup] skip R2 upload and retention prune");
    } else {
      const client = new R2Client(config.r2);
      console.log(`[backup] uploading to r2://${config.r2.bucket}/${archive.objectKey}`);
      await client.putFile(archive.objectKey, archive.archivePath);

      if (config.retentionDays > 0) {
        const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000);
        const listed = await client.listObjects(`${config.prefix}/`);
        const expired = selectExpiredBackups(listed, cutoff, config.prefix);
        for (const object of expired) {
          console.log(`[backup] pruning ${object.key} (last modified ${object.lastModified.toISOString()})`);
          await client.deleteObject(object.key);
        }
        console.log(`[backup] pruned ${expired.length} expired object(s); retention ${config.retentionDays}d`);
      } else {
        console.log("[backup] retention disabled (BACKUP_RETENTION_DAYS=0)");
      }
    }
  } finally {
    if (!dryRun) {
      await archive.cleanup();
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`[backup] done in ${(elapsedMs / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error("[backup] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
