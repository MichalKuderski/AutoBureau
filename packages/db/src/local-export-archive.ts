import { constants } from "node:fs";
import { lstat, realpath, open, link, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { crc32 } from "node:zlib";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { ExportArchiveManifestSchema, PrivacyExportIdSchema, EXPORT_V3_CATEGORIES, type ExportArchiveManifest, type ExportSnapshotV3 } from "@autobureau/contracts";
import type { Database } from "./scoped.js";
import { currentActor, recordAudit } from "./audit.js";
import { readOwnerExportSnapshotV3, readOwnerExportOriginalRefs, readOwnerExportStatus } from "./privacy-export.js";
import { journalExportPublication, assertExportPublication, revokeExportPublication, type ExportPublication } from "./export-artifact-journal.js";

/** Bounds: custody holds at most 20 objects/500 MiB per household; the archive adds JSONL
 * and headers. Anything larger refuses instead of silently dropping content. */
export const EXPORT_ARCHIVE_MAX_BYTES = 629_145_600;
const PREFIX = Buffer.from("pellum-local-export/v3\n");
const refuse = (): never => { throw new Error("Local export unavailable"); };
const safeId = (v: string) => { const p = PrivacyExportIdSchema.safeParse(v); return p.success ? p.data.toLowerCase() : refuse(); };
const EXT: Readonly<Record<string, string>> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "message/rfc822": "eml" };
export interface CustodyReader { readVerified(r: { householdId: string; objectId: string; sha256: string; size: number }): Uint8Array }

/* Minimal store-only ZIP (no compression, no ZIP64): fixed server-generated ASCII names,
 * CRC-32 and sizes known before each header, so no data descriptors are needed. */
function dosTime(d: Date) {
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}
function zipParts(entries: ReadonlyArray<{ name: string; bytes: Uint8Array }>, at: Date): Uint8Array[] {
  const { time, date } = dosTime(at), parts: Uint8Array[] = [], central: Buffer[] = [];
  let offset = 0;
  if (entries.length > 65000) refuse();
  for (const e of entries) {
    if (!/^[A-Za-z0-9_./-]{1,120}$/.test(e.name) || e.name.includes("..") || e.name.startsWith("/")) refuse();
    const name = Buffer.from(e.name, "ascii"), crc = crc32(e.bytes) >>> 0, size = e.bytes.byteLength;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0, 8); dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(size, 20); dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, name, e.bytes); central.push(dir, name); offset += 30 + name.length + size;
    if (offset > EXPORT_ARCHIVE_MAX_BYTES) refuse();
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return [...parts, cd, end];
}
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const jsonl = (rows: readonly unknown[]) => Buffer.from(rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));

/** Pure: snapshot + verified originals -> archive members and manifest. Completeness is
 * true only if no in-scope category or original is missing and no identifier value
 * exists that this build cannot reveal. */
export function composeExportArchive(snapshot: ExportSnapshotV3, originals: ReadonlyArray<{ documentId: string; mediaType: string; bytes: Uint8Array } | { documentId: string; reason: ExportArchiveManifest["originals"]["notIncluded"][number]["reason"] }>) {
  const members: Array<{ name: string; bytes: Uint8Array }> = [];
  const categories: ExportArchiveManifest["categories"] = [];
  for (const name of EXPORT_V3_CATEGORIES) {
    const value = snapshot[name];
    const rows = Array.isArray(value) ? value : value === null ? [] : [value];
    const bytes = jsonl(rows), file = `data/${name}.jsonl`;
    members.push({ name: file, bytes });
    categories.push({ name, file, records: rows.length, sha256: sha256(bytes), schema: `pellum.export.${name}.v3` });
  }
  const included: ExportArchiveManifest["originals"]["included"] = [], notIncluded: ExportArchiveManifest["originals"]["notIncluded"] = [];
  for (const o of originals) {
    if ("reason" in o) { notIncluded.push({ documentId: o.documentId, reason: o.reason }); continue; }
    const file = `originals/${o.documentId}.${EXT[o.mediaType] ?? "bin"}`;
    members.push({ name: file, bytes: o.bytes });
    included.push({ documentId: o.documentId, file, bytes: o.bytes.byteLength, sha256: sha256(o.bytes), mediaType: o.mediaType });
  }
  const omissions: ExportArchiveManifest["omissions"] = [];
  if (snapshot.identifiers.stored > 0) omissions.push({ category: "identifier-values", reason: "Stored identifier values cannot be revealed until the separately reviewed reveal boundary exists (ADR-007)." });
  if (notIncluded.length) omissions.push({ category: "original-documents", reason: "Some originals are not held in scanned clean custody; each is listed with its reason." });
  const manifest = ExportArchiveManifestSchema.parse({
    format: "pellum-household-export", version: 3, householdId: snapshot.householdId, requestId: snapshot.requestId,
    snapshotAt: snapshot.snapshotAt, expiresAt: snapshot.expiresAt, complete: omissions.length === 0,
    categories, originals: { included, notIncluded }, omissions,
    notHeldByPellum: ["Sign-in credentials and authenticator factors are held by the identity provider.",
      "Card and subscription details are held by the payment provider.",
      "Bank credentials are never collected; financial provider copies are governed by that provider."],
    integrity: { algorithm: "sha256", note: "Each data file and original is listed with its SHA-256; recompute to verify." },
  });
  const readme = Buffer.from([
    "Pellum household export (format version 3)", "",
    `Created ${snapshot.snapshotAt} for household ${snapshot.householdId}.`,
    `Complete: ${manifest.complete ? "yes" : "no — see manifest.json omissions"}.`, "",
    "manifest.json lists every file with its SHA-256 hash, record counts and anything not included.",
    "data/*.jsonl holds one JSON record per line. originals/ holds your original documents.", "",
  ].join("\n"));
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, members: [{ name: "manifest.json", bytes: manifestBytes }, { name: "README.txt", bytes: readme }, ...members] };
}

/** LOCAL synthetic storage only (explicit loopback mount). AES-256-GCM with a caller-
 * custodied key, fresh nonce, household/request-bound AAD; plaintext never touches disk.
 * DB transactions never span file I/O. Hosted object storage/KMS is not implemented. */
export function createLocalExportArchiveVault(root: string, key: KeyObject, custody: CustodyReader, clock = Date.now) {
  if (key.type !== "secret" || key.symmetricKeySize !== 32) return refuse();
  async function directory() {
    const p = resolve(root), s = await lstat(p);
    if (!(p.startsWith("/private/tmp/pellum-export-vault-") || p.startsWith("/tmp/pellum-export-vault-")) || !s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.() || await realpath(p) !== p) return refuse();
    return p;
  }
  async function paths(householdId: string, requestId: string) {
    const household = safeId(householdId), request = safeId(requestId), dir = await directory(), base = `${household}_${request}`;
    return { household, request, dir, file: join(dir, `${base}.archive`), revoked: join(dir, `${base}.archive-revoked`), aad: Buffer.from(`pellum-local-export/v3\n${household}\n${request}`) };
  }
  const absent = async (p: string) => { try { await lstat(p); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw e; } };
  async function authorize(db: Database, p: Awaited<ReturnType<typeof paths>>) {
    const actor = currentActor(); if (actor?.type !== "user") return refuse();
    const status = await readOwnerExportStatus(db, p.household, p.request);
    const now = clock(); if (!Number.isSafeInteger(now) || status.expiresAt.getTime() <= now || !await absent(p.revoked)) return refuse();
    return { status, ownerId: actor.userId };
  }
  async function stat(p: Awaited<ReturnType<typeof paths>>) {
    const f = await open(p.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const s = await f.stat(); if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) !== 0 || s.size < PREFIX.length + 28 || s.size > EXPORT_ARCHIVE_MAX_BYTES + PREFIX.length + 28) return refuse(); return s; }
    finally { await f.close(); }
  }
  /** Streams the file once: returns ciphertext digest and authenticates the GCM tag. */
  async function verify(p: Awaited<ReturnType<typeof paths>>, sink?: (chunk: Buffer) => void) {
    const s = await stat(p), f = await open(p.file, constants.O_RDONLY | constants.O_NOFOLLOW), digest = createHash("sha256");
    try {
      const head = Buffer.alloc(PREFIX.length + 12), tag = Buffer.alloc(16);
      await f.read(head, 0, head.length, 0); await f.read(tag, 0, 16, s.size - 16);
      if (!head.subarray(0, PREFIX.length).equals(PREFIX)) return refuse();
      const d = createDecipheriv("aes-256-gcm", key, head.subarray(PREFIX.length)); d.setAAD(p.aad); d.setAuthTag(tag);
      digest.update(head);
      const body = f.createReadStream({ autoClose: false, start: head.length, end: s.size - 17, highWaterMark: 1 << 20 });
      for await (const chunk of body as AsyncIterable<Buffer>) { digest.update(chunk); const plain = d.update(chunk); if (sink) sink(plain); else plain.fill(0); }
      d.final(); digest.update(tag);
      return { digest: digest.digest("hex"), bytes: s.size };
    } catch { return refuse(); } finally { await f.close(); }
  }
  return {
    async build(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId), a = await authorize(db, p);
      if (!await absent(p.file)) {
        const existing = await verify(p);
        const [row] = await db.withHousehold(p.household, tx => tx.$queryRaw<Array<{ complete: boolean; snapshot_at: Date; expires_at: Date }>>`
          SELECT complete,snapshot_at,expires_at FROM local_export_artifacts WHERE household_id=${p.household}::uuid AND request_id=${p.request}::uuid AND format='archive-v3' AND state='partial'`);
        if (!row) return refuse();
        await assertExportPublication(db, { householdId: p.household, requestId: p.request, ownerId: a.ownerId, digest: existing.digest, bytes: existing.bytes,
          snapshotAt: row.snapshot_at.toISOString(), expiresAt: row.expires_at.toISOString(), format: "archive-v3", complete: row.complete });
        return { reused: true, complete: row.complete, bytes: existing.bytes, expiresAt: row.expires_at.toISOString() };
      }
      const snapshot = await readOwnerExportSnapshotV3(db, p.household, p.request);
      const refs = await readOwnerExportOriginalRefs(db, p.household, p.request);
      let total = 0;
      const originals = refs.map(r => {
        if (!r.custody) return { documentId: r.documentId, reason: r.documentStatus === "rejected" ? "rejected-by-scanner" as const
          : r.custodyState === "cancelled" || r.custodyState === "absent" ? "no-longer-retained" as const
          : ["received","scanning"].includes(r.documentStatus) ? "not-scanned-clean" as const : "not-yet-in-custody" as const };
        total += r.custody.size; if (total > 524_288_000) return refuse();
        // Hash/size mismatch against the immutable custody binding refuses the whole build.
        return { documentId: r.documentId, mediaType: r.mediaType, bytes: custody.readVerified({ householdId: p.household, ...r.custody }) };
      });
      const { manifest, members } = composeExportArchive(snapshot, originals);
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(p.aad);
      const temporary = join(p.dir, `${p.household}_${p.request}_${randomUUID()}.pending`), digest = createHash("sha256");
      const f = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let bytes = 0, published = false;
      const write = async (b: Uint8Array) => { if (b.byteLength) { digest.update(b); bytes += b.byteLength; await f.write(b); } };
      try {
        await write(PREFIX); await write(nonce);
        for (const part of zipParts(members, new Date(snapshot.snapshotAt))) await write(cipher.update(part));
        await write(cipher.final()); await write(cipher.getAuthTag());
        await f.sync(); await f.close();
        await authorize(db, p);
        try { await link(temporary, p.file); published = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      } finally { await f.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); }
      if (!published) return refuse(); // A concurrent builder won; the caller retries as a reuse.
      try {
        const check = await verify(p);
        if (check.digest !== digest.digest("hex") || check.bytes !== bytes) return refuse();
        const publication: ExportPublication = { householdId: p.household, requestId: p.request, ownerId: a.ownerId, digest: check.digest, bytes,
          snapshotAt: snapshot.snapshotAt, expiresAt: snapshot.expiresAt, format: "archive-v3", complete: manifest.complete };
        await journalExportPublication(db, publication);
        await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_built", { type: "export", id: p.request }));
        return { reused: false, complete: manifest.complete, bytes, expiresAt: snapshot.expiresAt, omissions: manifest.omissions.map(o => o.category) };
      } catch (e) { await unlink(p.file).catch(() => undefined); throw e; }
    },
    /** Authenticates the whole ciphertext (pass 1) before releasing any plaintext (pass 2);
     * each call re-checks owner, intent expiry, revocation and the journal binding. */
    async download(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId), a = await authorize(db, p);
      const first = await verify(p);
      const [row] = await db.withHousehold(p.household, tx => tx.$queryRaw<Array<{ complete: boolean; snapshot_at: Date; expires_at: Date }>>`
        SELECT complete,snapshot_at,expires_at FROM local_export_artifacts WHERE household_id=${p.household}::uuid AND request_id=${p.request}::uuid AND format='archive-v3' AND state='partial'`);
      if (!row) return refuse();
      await assertExportPublication(db, { householdId: p.household, requestId: p.request, ownerId: a.ownerId, digest: first.digest, bytes: first.bytes,
        snapshotAt: row.snapshot_at.toISOString(), expiresAt: row.expires_at.toISOString(), format: "archive-v3", complete: row.complete });
      const chunks: Buffer[] = [];
      const second = await verify(p, c => chunks.push(Buffer.from(c)));
      if (second.digest !== first.digest) return refuse();
      await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_read", { type: "export", id: p.request }));
      return Buffer.concat(chunks);
    },
    async status(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId);
      const [row] = await db.withHousehold(p.household, tx => tx.$queryRaw<Array<{ state: string; complete: boolean; size_bytes: number; expires_at: Date }>>`
        SELECT state,complete,size_bytes,expires_at FROM local_export_artifacts WHERE household_id=${p.household}::uuid AND request_id=${p.request}::uuid AND format='archive-v3'`);
      return row ? { state: row.state === "partial" ? "ready" as const : "revoked" as const, complete: row.complete, bytes: row.size_bytes, expiresAt: row.expires_at.toISOString() } : null;
    },
    async revoke(db: Database, householdId: string, requestId: string) {
      const p = await paths(householdId, requestId);
      await readOwnerExportStatus(db, p.household, p.request);
      await revokeExportPublication(db, p.household, p.request);
      try { const m = await open(p.revoked, "wx", 0o600); await m.sync(); await m.close(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      if (!await absent(p.file)) await unlink(p.file);
      await db.withHousehold(p.household, tx => recordAudit(tx, "privacy.export_artifact_revoked", { type: "export", id: p.request }));
      return { localArtifactAbsent: await absent(p.file), providerAndBackupProof: false as const };
    },
  };
}
