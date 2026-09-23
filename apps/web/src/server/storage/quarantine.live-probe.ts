import { it } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { QuarantineStorage, storageConfigFromEnv, UPLOAD_MAX_BYTES } from "./quarantine";

// This file creates only opaque, synthetic S3 fixtures. No database, email, queue,
// model or document-intake handler is invoked. SDK/fetch errors never leave memory.
const bucket = "pellum-stg-quarantine-792394000571-us-east-2";
const role = (scope: string) => `arn:aws:iam::792394000571:role/pellum-${scope}-upload-signer`;
function requireTrue(value: unknown): asserts value { if (!value) throw new Error("Synthetic storage assertion failed"); }
const sdkStatus = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
const sdkConfig = { region: "us-east-2", maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } };

it("proves only the authorized native staging storage boundary with synthetic fixtures", async () => {
  const scope = process.env["VERCEL_ENV"] === "production" ? "stg" : "preview";
  requireTrue(process.env["PELLUM_STAGING_STORAGE_PROBE"] === "1" && process.env["PELLUM_STAGING_OIDC_PROOF"] === "1"
    && process.env["VERCEL"] === "1" && ["production", "preview"].includes(process.env["VERCEL_ENV"] ?? "")
    && process.env["VERCEL_ENV"] === process.env["PELLUM_STAGING_OIDC_SCOPE"]
    && process.env["VERCEL_PROJECT_ID"] === "prj_qAjK6wDYXoGn02Sl8jjSmrvy4NLR"
    && process.env["VERCEL_ORG_ID"] === "team_CNQd2ynmaV1xtRhB6NMMeYBs"
    && process.env["DOCUMENT_INTAKE_ENABLED"] !== "true"
    && !process.env["AWS_ACCESS_KEY_ID"] && !process.env["AWS_SECRET_ACCESS_KEY"]);
  const household = randomUUID(), upload = randomUUID(), base = `hh/${household}/upload/${upload}`;
  const incoming = `${base}/incoming`, selected = `${base}/sealed/${randomUUID()}`, raced = `${base}/sealed/${randomUUID()}`;
  const receipt = { capturedAt: new Date().toISOString(), evidenceSource: "vercel-native-build", scope,
    bucket, roleArn: role(scope), intakeEnabled: false, realTenantData: false, productionApplicationAccessed: false,
    fixture: { household, upload, incoming, sealed: [selected, raced] }, results: [] as { name: string; status: string }[],
    incomingCleanup: "requires-exact-operator-cleanup", sealedCleanup: false };
  let failures = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); receipt.results.push({ name, status: "PASS" }); }
    catch { failures++; receipt.results.push({ name, status: "FAIL" }); }
  };
  const config = storageConfigFromEnv({ NODE_ENV: "test", STORAGE_PROVIDER: "aws-oidc", VERCEL_ENV: process.env["VERCEL_ENV"],
    AUTH_ISSUER: "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1", STORAGE_S3_REGION: "us-east-2",
    STORAGE_QUARANTINE_BUCKET: bucket, STORAGE_AWS_ROLE_ARN: role(scope) });
  const storage = new QuarantineStorage(config);
  const credentials = awsCredentialsProvider({ roleArn: role(scope), durationSeconds: 900, clientConfig: sdkConfig });
  const client = new S3Client({ ...sdkConfig, endpoint: "https://s3.us-east-2.amazonaws.com", forcePathStyle: true,
    credentials, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const body = Buffer.from("%PDF-1.4\n% Pellum synthetic fixture A\n%%EOF\n");
  const replacement = Buffer.from("%PDF-1.4\n% Pellum synthetic fixture B\n%%EOF\n");
  const claim = { key: incoming, mime: "application/pdf" as const, size: body.length };
  const put = async (url: string, bytes = body, type = claim.mime): Promise<number> => {
    const r = await fetch(url, { method: "PUT", body: bytes, headers: { "content-type": type, "content-length": String(bytes.length) },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    await r.arrayBuffer(); return r.status;
  };
  const read = async (key: string) => {
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    requireTrue(r.Body); return Buffer.from(await r.Body.transformToByteArray());
  };
  const deniedSdk = async (run: () => Promise<unknown>) => {
    let status: number | undefined;
    try { await run(); } catch (error) { status = sdkStatus(error); }
    requireTrue(status === 403);
  };
  try {
    await check("native-scope-role-assumption", async () => {
      const c = await credentials(); requireTrue(c.sessionToken && c.expiration && c.expiration.getTime() > Date.now());
    });
    requireTrue(failures === 0);
    await check("wrong-environment-role-denied", async () => {
      const other = awsCredentialsProvider({ roleArn: role(scope === "stg" ? "preview" : "stg"), durationSeconds: 900, clientConfig: sdkConfig });
      await deniedSdk(() => other());
    });
    const capability = await storage.issue(claim);
    await check("capability-max-fifteen-minutes-and-sts-lifetime", async () => {
      const c = await credentials(), url = new URL(capability.url);
      requireTrue(Number(url.searchParams.get("X-Amz-Expires")) <= 900 && c.expiration
        && capability.expiresAt.getTime() <= c.expiration.getTime() + 1000);
      requireTrue(url.searchParams.get("X-Amz-SignedHeaders") === "content-length;content-type;host");
    });
    await check("changed-content-length-denied", async () => { requireTrue(await put(capability.url, Buffer.concat([body, Buffer.from("x")])) === 403); });
    await check("changed-content-type-denied", async () => { requireTrue(await put(capability.url, body, "image/png" as typeof claim.mime) === 403); });
    await check("unsupported-type-refused", async () => {
      let refused = false; try { await storage.issue({ ...claim, mime: "text/html" as typeof claim.mime }); }
      catch (e) { refused = (e as { code?: string }).code === "invalid-object"; } requireTrue(refused);
    });
    await check("oversize-refused", async () => {
      let refused = false; try { await storage.issue({ ...claim, size: UPLOAD_MAX_BYTES + 1 }); }
      catch (e) { refused = (e as { code?: string }).code === "invalid-object"; } requireTrue(refused);
    });
    await check("expired-capability-denied", async () => {
      const expired = await storage.issue(claim, new Date(Date.now() - 16 * 60_000)); requireTrue(await put(expired.url) === 403);
    });
    await check("valid-exact-put", async () => { requireTrue(await put(capability.url) === 200); requireTrue((await read(incoming)).equals(body)); });
    requireTrue(receipt.results.find(r => r.name === "valid-exact-put")?.status === "PASS");
    await check("seal-private-copy", async () => { await storage.seal(claim, selected); requireTrue((await read(selected)).equals(body)); });
    await check("reused-incoming-capability-cannot-change-selected-copy", async () => {
      requireTrue(await put(capability.url, replacement) === 200);
      requireTrue((await read(incoming)).equals(replacement) && (await read(selected)).equals(body));
    });
    await check("conditional-copy-sealing-race-denied", async () => {
      const before = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: incoming }));
      requireTrue(before.ETag); requireTrue(await put(capability.url, body) === 200);
      let status: number | undefined;
      try { await client.send(new CopyObjectCommand({ Bucket: bucket, Key: raced,
        CopySource: `${bucket}/${incoming}`, CopySourceIfMatch: before.ETag })); }
      catch (e) { status = sdkStatus(e); } requireTrue(status === 412);
    });
    await check("anonymous-get-denied", async () => {
      const r = await fetch(`https://s3.us-east-2.amazonaws.com/${bucket}/${incoming}`, { redirect: "error" }); await r.arrayBuffer(); requireTrue(r.status === 403);
    });
    await check("anonymous-list-denied", async () => {
      const r = await fetch(`https://s3.us-east-2.amazonaws.com/${bucket}?list-type=2`, { redirect: "error" }); await r.arrayBuffer(); requireTrue(r.status === 403);
    });
    await check("runtime-list-denied", async () => { await deniedSdk(() => client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))); });
    await check("query-signed-quarantine-download-denied", async () => {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: incoming }), { expiresIn: 60 });
      const r = await fetch(url, { redirect: "error", cache: "no-store" }); await r.arrayBuffer(); requireTrue(r.status === 403);
    });
    await check("query-signed-sealed-overwrite-denied", async () => {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: selected, ContentType: claim.mime, ContentLength: body.length }),
        { expiresIn: 60, signableHeaders: new Set(["content-type", "content-length"]) });
      requireTrue(await put(url, replacement) === 403); requireTrue((await read(selected)).equals(body));
    });
  } finally {
    await check("exact-sealed-fixture-cleanup", async () => {
      for (const key of [selected, raced]) await storage.discard(key);
      // GetObject without ListBucket returns 403 for a missing object. Operator's
      // later exact prefix inventory is the independent absence proof.
      receipt.sealedCleanup = true;
    });
    storage.close(); client.destroy();
    await writeFile("staging-storage-native-receipt.json", JSON.stringify(receipt), { mode: 0o600 });
  }
  requireTrue(failures === 0);
});
