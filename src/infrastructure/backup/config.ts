export type BackupR2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
};

export type BackupConfig = {
  dataDir: string;
  prefix: string;
  retentionDays: number;
  r2: BackupR2Config;
};

const DEFAULT_DATA_DIR = "./data";
const DEFAULT_PREFIX = "nexus";
const DEFAULT_RETENTION_DAYS = 30;

export function loadBackupConfig(
  env: NodeJS.Dict<string>,
  options: { requireR2: boolean } = { requireR2: true },
): BackupConfig {
  const dataDir = env.BACKUP_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  const prefix = normalizePrefix(env.R2_BACKUP_PREFIX?.trim() || DEFAULT_PREFIX);
  const retentionDays = readNonNegativeInt(env.BACKUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);

  if (!options.requireR2) {
    return {
      dataDir,
      prefix,
      retentionDays,
      r2: {
        accountId: env.R2_ACCOUNT_ID?.trim() ?? "",
        accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? "",
        secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
        bucket: env.R2_BUCKET?.trim() ?? "",
        endpoint: env.R2_ENDPOINT?.trim() || undefined,
      },
    };
  }

  return {
    dataDir,
    prefix,
    retentionDays,
    r2: {
      accountId: required(env, "R2_ACCOUNT_ID"),
      accessKeyId: required(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "R2_SECRET_ACCESS_KEY"),
      bucket: required(env, "R2_BUCKET"),
      endpoint: env.R2_ENDPOINT?.trim() || undefined,
    },
  };
}

export function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

export function r2Endpoint(config: BackupR2Config): string {
  if (config.endpoint) return config.endpoint.replace(/\/+$/, "");
  if (!config.accountId) {
    throw new Error("R2_ACCOUNT_ID is not set (or set R2_ENDPOINT).");
  }
  return `https://${config.accountId}.eu.r2.cloudflarestorage.com`;
}

function required(env: NodeJS.Dict<string>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Store R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in fnox; put R2_ACCOUNT_ID and R2_BUCKET in .env.local.`,
    );
  }
  return value;
}

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
