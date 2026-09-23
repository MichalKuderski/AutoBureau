import { constants } from "node:fs";
import { lstat, realpath, open, link, unlink, opendir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { ReadableLocalExportSnapshotSchema, localExportOmissions, PrivacyExportIdSchema, type ReadableLocalExportSnapshot } from "@autobureau/contracts";
import type { Database } from "./scoped.js";
import { currentActor, recordAudit } from "./audit.js";
import { readOwnerExportSnapshot, readOwnerExportStatus } from "./privacy-export.js";

import { journalExportPublication, assertExportPublication, revokeExportPublication, type ExportPublication } from "./export-artifact-journal.js";

const MAX_BYTES = 4 * 1024 * 1024;
const refuse = (): never => { throw new Error("Local export unavailable"); };
const safeId = (v: string) => { const p = PrivacyExportIdSchema.safeParse(v); return p.success ? p.data.toLowerCase() : refuse(); };
const prefix = Buffer.from("pellum-local-export/v1\n");

/** Synthetic/local filesystem proof only, no hosted adapter, signed URL or route.
 * AES-256-GCM uses a caller-custodied 256-bit KeyObject and fresh 96-bit nonce.
 * No plaintext is written to disk, no key is persisted. DB/outbox owns request
 * authority; an immutable encrypted file owns this local artifact snapshot. */
export function createLocalExportVault(root: string, key: KeyObject, clock = Date.now) {
  if (key.type !== "secret" || key.symmetricKeySize !== 32) return refuse();
  const publications = new WeakMap<ReadableLocalExportSnapshot, ExportPublication>();
  const publication = (s: ReadableLocalExportSnapshot) => publications.get(s) ?? refuse();
  async function directory() {
    const p = resolve(root), s = await lstat(p);
    if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.() || await realpath(p) !== p) return refuse();
    return p;
  }
  async function paths(householdId: string, requestId: string) {
    const household = safeId(householdId), request = safeId(requestId), dir = await directory();
    const basename = `${household}_${request}`;
    return { household, request, dir, file: join(dir, basename + ".encrypted"), revoked: join(dir, basename + ".revoked"), aad: Buffer.from(`pellum-local-export/v1\n${household}\n${request}`) };
  }
  async function absent(path: string) {
    try { await lstat(path); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; }
  }
  async function syncDirectory(path: string) {
    const dir = await open(path, constants.O_RDONLY);
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async function read(p: Awaited<ReturnType<typeof paths>>, cleanupOnly = false): Promise<ReadableLocalExportSnapshot> {
    if (!cleanupOnly && !await absent(p.revoked)) return refuse();
    const file = await open(p.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES || stat.size < prefix.length + 28 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.nlink !== 1) return refuse();
      bytes = Buffer.alloc(stat.size);
      const result = await file.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead !== bytes.length) return refuse();
    } finally { await file.close(); }
    if (!bytes.subarray(0, prefix.length).equals(prefix)) return refuse();
    const offset = prefix.length, decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(offset, offset+12));
    decipher.setAAD(p.aad); decipher.setAuthTag(bytes.subarray(offset+12, offset+28));
    let plaintext: Buffer | undefined;
    try {
      plaintext = Buffer.concat([decipher.update(bytes.subarray(offset+28)), decipher.final()]);
      const parsed = ReadableLocalExportSnapshotSchema.safeParse(JSON.parse(plaintext.toString("utf8")));
      if (!parsed.success || parsed.data.householdId !== p.household || parsed.data.requestId !== p.request) return refuse();
      publications.set(parsed.data, { householdId:p.household, requestId:p.request, ownerId:parsed.data.ownerId,
        digest:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,snapshotAt:parsed.data.snapshotAt,expiresAt:parsed.data.expiresAt });
      return parsed.data;
    } catch { return refuse(); } finally { plaintext?.fill(0); }
  }
  async function authorize(db: Database, p: Awaited<ReturnType<typeof paths>>, snapshot?: ReadableLocalExportSnapshot) {
    const actor = currentActor(); if (actor?.type !== "user") return refuse();
    const status = await readOwnerExportStatus(db, p.household, p.request);
    const now = clock(); if (!Number.isSafeInteger(now) || now < 0 || status.expiresAt.getTime() <= now || !await absent(p.revoked)) return refuse();
    if (snapshot && (snapshot.ownerId !== actor.userId || Date.parse(snapshot.expiresAt) !== status.expiresAt.getTime()
      || Date.parse(snapshot.expiresAt) <= now || Date.parse(snapshot.snapshotAt) > now || Date.parse(snapshot.expiresAt) - Date.parse(snapshot.snapshotAt) > 72*3600_000)) return refuse();
    return status;
  }
  return {
    async build(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId); await authorize(db, p);
      if (!await absent(p.file)) {
        const existing = await read(p); await authorize(db, p, existing);
        await journalExportPublication(db, publication(existing));
        return { snapshotAt: existing.snapshotAt, expiresAt: existing.expiresAt, complete: false as const, omissions: localExportOmissions(existing), reused: true };
      }
      const snapshot = await readOwnerExportSnapshot(db, p.household, p.request);
      const plaintext = Buffer.from(JSON.stringify(snapshot));
      if (plaintext.length > MAX_BYTES - prefix.length - 28) { plaintext.fill(0); return refuse(); }
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(p.aad);
      let encrypted: Buffer;
      try { const body = Buffer.concat([cipher.update(plaintext), cipher.final()]); encrypted = Buffer.concat([prefix, nonce, cipher.getAuthTag(), body]); }
      finally { plaintext.fill(0); }
      const temporary = join(p.dir, `${p.household}_${p.request}_${randomUUID()}.pending`);
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let published = false;
      try {
        await file.writeFile(encrypted); await file.sync(); await file.close();
        await authorize(db, p, snapshot);
        try { await link(temporary, p.file); published = true; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      } finally { await file.close().catch(() => undefined); await unlink(temporary); }
      try {
        const committed = await read(p); await authorize(db, p, committed);
        await syncDirectory(p.dir);
        await journalExportPublication(db, publication(committed));
        await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_built", { type: "export", id: p.request }));
        return { snapshotAt: committed.snapshotAt, expiresAt: committed.expiresAt, complete: false as const, omissions: localExportOmissions(committed), reused: !published };
      } catch (e) { if (published) await unlink(p.file).catch(() => undefined); throw e; }
    },
    async download(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId); await authorize(db, p);
      const snapshot = await read(p); await authorize(db, p, snapshot);
      await assertExportPublication(db, publication(snapshot));
      await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_read", { type: "export", id: p.request }));
      // JSONL equivalent: explicit manifest followed by closed source projections.
      // No cacheable URL or bearer capability is minted. Each invocation reauthorizes.
      const { items, obligations, documents, members, reminders, entitlements } = snapshot;
      const manifest={version:snapshot.version,scope:snapshot.scope,complete:snapshot.complete,
        householdId:snapshot.householdId,requestId:snapshot.requestId,ownerId:snapshot.ownerId,
        snapshotAt:snapshot.snapshotAt,expiresAt:snapshot.expiresAt,
        ...(snapshot.version===2&&snapshot.documentWork!==undefined?{documentWork:snapshot.documentWork}:{}),
        ...(snapshot.version===2&&snapshot.testSubscription!==undefined?{testSubscription:snapshot.testSubscription}:{} )};
      const lines = [JSON.stringify({ type: "manifest", ...manifest, omissions: localExportOmissions(snapshot) })];
      const recordsBySource={items,obligations,documents,members,reminders,entitlements,
        ...(snapshot.version===2?{account:[snapshot.account],profile:snapshot.profile?[snapshot.profile]:[],household:[snapshot.household],
          notificationPreferences:snapshot.notificationPreferences,notificationHistory:snapshot.notificationHistory,activityHistory:snapshot.activityHistory}:{})};
      for (const [source, records] of Object.entries(recordsBySource)) {
        for (const record of records) lines.push(JSON.stringify({ type: source, record }));
      }
      await authorize(db, p, snapshot); // expiry/fence/revocation after serialization
      await assertExportPublication(db, publication(snapshot));
      return Buffer.from(lines.join("\n") + "\n");
    },
    async revoke(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId);
      // Owner initiation path; post-fence/expiry cleanup uses the restricted method
      // below. The marker makes same-request regeneration fail closed.
      await readOwnerExportStatus(db, p.household, p.request);
      await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_revocation_requested", { type: "export", id: p.request }));
      await revokeExportPublication(db, p.household, p.request);
      try { const marker = await open(p.revoked, "wx", 0o600); await marker.sync(); await marker.close(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      await syncDirectory(p.dir); // persist the deny marker before destructive cleanup
      if (!await absent(p.file)) await unlink(p.file);
      await syncDirectory(p.dir);
      await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_revoked", { type: "export", id: p.request }));
      return { localArtifactAbsent: await absent(p.file), providerAndBackupProof: false as const };
    },
    /** Bounded request-scoped cleanup of AUTHENTICATED expired ciphertext only.
     * A paused writer can no longer publish after this original request TTL. Old
     * unscoped/random-name pending files are retained, never guessed into a tenant.
     * No downloaded copies, backups or journal retirement are covered. */
    async sweepExpiredPending(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId), actor = currentActor();
      if (actor?.type !== "user") return refuse();
      async function audit(action: "privacy.export_pending_cleanup_requested" | "privacy.export_pending_cleanup_observed") {
        return db.withHousehold(p.household, async tx => {
          if (!await tx.householdUser.findFirst({ where: { householdId:p.household,userId:actor!.type === "user" ? actor!.userId : "",role:"owner" } })) return refuse();
          await recordAudit(tx, action, { type:"export",id:p.request });
        });
      }
      await audit("privacy.export_pending_cleanup_requested");
      let scanned=0, removed=0, refused=0, bounded=false;
      const dir=await opendir(p.dir);
      for await (const entry of dir) {
        if (++scanned>1000) { bounded=true;break; }
        if (!entry.name.startsWith(`${p.household}_${p.request}_`) || !entry.name.endsWith(".pending")) continue;
        const nonce=entry.name.slice(p.household.length+p.request.length+2,-8);
        if (!PrivacyExportIdSchema.safeParse(nonce).success) { refused++;continue; }
        const pending=join(p.dir,entry.name);
        try {
          const snapshot=await read({...p,file:pending},true), now=clock();
          if (!Number.isSafeInteger(now) || now<0 || Date.parse(snapshot.expiresAt)>now) { refused++;continue; }
          await unlink(pending);await syncDirectory(p.dir);
          if (!await absent(pending)) return refuse();
          removed++;
        } catch { refused++; }
      }
      await audit("privacy.export_pending_cleanup_observed");
      return {scanned:Math.min(scanned,1000),removed,refused,bounded,complete:false as const,providerAndBackupProof:false as const};
    },
    async expire(householdId: string, requestId: string) {
      const p = await paths(householdId, requestId);
      if (await absent(p.file)) return { localArtifactAbsent: true, providerAndBackupProof: false as const };
      // A crash after durable revocation but before unlink must remain cleanable.
      // Only expiry cleanup bypasses the marker; authenticated ciphertext and TTL
      // are still mandatory, and this path can never return content.
      const snapshot = await read(p, true), now = clock();
      if (!Number.isSafeInteger(now) || Date.parse(snapshot.expiresAt) > now) return refuse();
      await unlink(p.file); await syncDirectory(p.dir);
      // Separate filesystem read, not a DELETE acknowledgement promoted to absence.
      return { localArtifactAbsent: await absent(p.file), providerAndBackupProof: false as const };
    },
  };
}
