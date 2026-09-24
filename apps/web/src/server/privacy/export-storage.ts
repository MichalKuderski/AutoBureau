import { createSecretKey } from "node:crypto";
import { createLocalExportArchiveVault, localCleanCustody } from "@autobureau/db";

/**
 * Where export archives live. Only an explicit LOCAL synthetic mount exists today: it
 * refuses production builds, Vercel/AWS runtimes and any non-loopback database, and its
 * key comes from local configuration. Hosted durable object storage and KMS-custodied
 * export keys are NOT implemented, so a hosted deployment reports export as unavailable
 * rather than writing archives somewhere unreviewed. Never log these values.
 */
export function exportArchiveStorage(env: Readonly<Record<string, string | undefined>> = process.env) {
  try {
    if (env.NODE_ENV === "production" || env.VERCEL || env.AWS_EXECUTION_ENV || env.LOCAL_PRIVACY_STORAGE !== "synthetic-only") return null;
    const database = new URL(env.DATABASE_URL ?? "");
    if (database.hostname !== "127.0.0.1" || database.username !== "app_user" || !database.pathname.startsWith("/pellum_")) return null;
    const root = env.LOCAL_EXPORT_VAULT ?? "", custody = env.LOCAL_CLEAN_CUSTODY_ROOT ?? "", key = env.LOCAL_EXPORT_KEY ?? "";
    if (!root.startsWith("/private/tmp/pellum-export-vault-") || !custody.startsWith("/private/tmp/pellum-clean-custody-") || !/^[a-f0-9]{64}$/.test(key)) return null;
    return createLocalExportArchiveVault(root, createSecretKey(Buffer.from(key, "hex")), localCleanCustody(custody));
  } catch { return null; }
}
