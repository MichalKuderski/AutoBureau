import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { UPLOAD_MAX_BYTES, UPLOAD_TTL_SECONDS, UPLOAD_MIME_TYPES, type UploadMime } from "@autobureau/contracts";
export { UPLOAD_MAX_BYTES, UPLOAD_TTL_SECONDS, UPLOAD_MIME_TYPES, type UploadMime } from "@autobureau/contracts";
export type StorageFailure = "not-found" | "changed" | "invalid-object" | "unavailable";

/** SDK errors can contain signed URLs, object names and credentials. Never retain them. */
export class StorageError extends Error {
  constructor(readonly code: StorageFailure) { super(`Document storage: ${code}`); this.name = "StorageError"; }
}
interface StorageLocation { endpoint: string; region: string; bucket: string }
export type StorageConfig = StorageLocation & (
  | { kind: "aws-oidc"; roleArn: string }
  | { kind?: "supabase"; accessKeyId: string; secretAccessKey: string }
);
type CredentialProvider = ReturnType<typeof awsCredentialsProvider>;
export interface UploadClaim { key: string; mime: UploadMime; size: number }

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  if (env["STORAGE_PROVIDER"] === "aws-oidc") {
    // ADR-016 is staging-only. Scope/role mismatch fails before any provider call.
    const scope = env["VERCEL_ENV"] === "production" ? "stg" : env["VERCEL_ENV"] === "preview" ? "preview" : null;
    const roleArn = `arn:aws:iam::792394000571:role/pellum-${scope}-upload-signer`;
    if (!scope || env["AUTH_ISSUER"] !== "https://kdqnfruwgocfqwpbpuxo.supabase.co/auth/v1"
      || env["STORAGE_AWS_ROLE_ARN"] !== roleArn || env["STORAGE_S3_REGION"] !== "us-east-2"
      || env["STORAGE_QUARANTINE_BUCKET"] !== "pellum-stg-quarantine-792394000571-us-east-2"
      || env["STORAGE_S3_ACCESS_KEY_ID"] || env["STORAGE_S3_SECRET_ACCESS_KEY"]) throw new StorageError("unavailable");
    return { kind: "aws-oidc", endpoint: "https://s3.us-east-2.amazonaws.com", region: "us-east-2",
      bucket: "pellum-stg-quarantine-792394000571-us-east-2", roleArn };
  }
  if (env["STORAGE_PROVIDER"] && env["STORAGE_PROVIDER"] !== "supabase") throw new StorageError("unavailable");
  // Derive the endpoint from this deployment's verified issuer configuration. A
  // separate arbitrary URL would make a misconfiguration a credential/SSRF leak.
  let issuer: URL;
  try { issuer = new URL(env["AUTH_ISSUER"] ?? ""); } catch { throw new StorageError("unavailable"); }
  const match = /^([a-z]{20})\.supabase\.co$/.exec(issuer.hostname);
  if (!match || issuer.protocol !== "https:" || issuer.port || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/auth/v1") throw new StorageError("unavailable");
  const region = env["STORAGE_S3_REGION"] ?? "", bucket = env["STORAGE_QUARANTINE_BUCKET"] ?? "";
  const accessKeyId = env["STORAGE_S3_ACCESS_KEY_ID"] ?? "", secretAccessKey = env["STORAGE_S3_SECRET_ACCESS_KEY"] ?? "";
  if (!/^us-(east|west)-[12]$/.test(region) || !/^[a-z][a-z0-9-]{2,62}$/.test(bucket) || !accessKeyId.trim() || !secretAccessKey.trim()) throw new StorageError("unavailable");
  return { endpoint: `https://${match[1]}.storage.supabase.co/storage/v1/s3`, region, bucket, accessKeyId, secretAccessKey };
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const incomingKey = new RegExp(`^hh/${uuid}/upload/${uuid}/incoming$`);
const sealedKey = new RegExp(`^hh/${uuid}/upload/${uuid}/sealed/${uuid}$`);
function assertClaim(claim: UploadClaim) {
  if (!incomingKey.test(claim.key) || !Number.isSafeInteger(claim.size) || claim.size < 1 || claim.size > UPLOAD_MAX_BYTES || !UPLOAD_MIME_TYPES.includes(claim.mime)) throw new StorageError("invalid-object");
}
function failure(cause: unknown): StorageError {
  const status = (cause as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return new StorageError(status === 404 ? "not-found" : status === 412 ? "changed" : "unavailable");
}

/** Network methods must be called outside Database.withHousehold. */
export class QuarantineStorage {
  private readonly client: S3Client;
  private readonly credentials: CredentialProvider;
  constructor(private readonly config: StorageConfig) {
    this.credentials = config.kind === "aws-oidc"
      ? awsCredentialsProvider({ roleArn: config.roleArn, durationSeconds: 900,
        clientConfig: { region: "us-east-2", maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 } } })
      : async () => ({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
    this.client = this.createClient(this.credentials);
  }

  private createClient(credentials: CredentialProvider): S3Client {
    return new S3Client({ endpoint: this.config.endpoint, region: this.config.region, forcePathStyle: true, credentials,
      maxAttempts: 1, requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  }

  async issue(claim: UploadClaim, issuedAt = new Date()): Promise<{ url: string; expiresAt: Date }> {
    assertClaim(claim);
    const signingDate = new Date(Math.floor(issuedAt.getTime() / 1_000) * 1_000);
    let signer: S3Client | undefined;
    try {
      // Freeze the exact credential snapshot used for both expiry and signature.
      // Never fall back to host credentials or a key without an STS expiry.
      const credentials = await this.credentials();
      if (this.config.kind === "aws-oidc" && (!credentials.sessionToken || !credentials.expiration)) throw new StorageError("unavailable");
      const expiresIn = credentials.expiration
        ? Math.min(UPLOAD_TTL_SECONDS, Math.floor((credentials.expiration.getTime() - signingDate.getTime()) / 1_000))
        : UPLOAD_TTL_SECONDS;
      if (!Number.isInteger(expiresIn) || expiresIn < 1) throw new StorageError("unavailable");
      signer = this.createClient(async () => credentials);
      const url = await getSignedUrl(signer, new PutObjectCommand({ Bucket: this.config.bucket, Key: claim.key,
        ContentType: claim.mime, ContentLength: claim.size }), { expiresIn, signingDate,
        signableHeaders: new Set(["content-type", "content-length"]) });
      return { url, expiresAt: new Date(signingDate.getTime() + expiresIn * 1_000) };
    } catch { throw new StorageError("unavailable"); }
    finally { signer?.destroy(); }
  }

  async seal(claim: UploadClaim, destination: string): Promise<void> {
    assertClaim(claim);
    if (!sealedKey.test(destination) || !destination.startsWith(claim.key.slice(0, -"incoming".length))) throw new StorageError("invalid-object");
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: claim.key }));
      if (head.ContentLength !== claim.size || head.ContentType !== claim.mime || !head.ETag || !/^"[A-Za-z0-9-]{1,128}"$/.test(head.ETag)) throw new StorageError("invalid-object");
      await this.client.send(new CopyObjectCommand({ Bucket: this.config.bucket, Key: destination,
        CopySource: [this.config.bucket, ...claim.key.split("/")].map(encodeURIComponent).join("/"),
        CopySourceIfMatch: head.ETag, MetadataDirective: "REPLACE", ContentType: claim.mime,
        ContentDisposition: "attachment", CacheControl: "private, no-store" }));
      // The incoming capability can still be used. Only this independently keyed
      // copy may enter the scanner queue; checking headers does not declare it safe.
      const sealed = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: destination }));
      if (sealed.ContentLength !== claim.size || sealed.ContentType !== claim.mime) throw new StorageError("invalid-object");
    } catch (cause) { if (cause instanceof StorageError) throw cause; throw failure(cause); }
  }

  /** Only an unselected attempt may be discarded. Domain code owns that decision. */
  async discard(destination: string): Promise<void> {
    if (!sealedKey.test(destination)) throw new StorageError("invalid-object");
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: destination })); }
    catch (cause) { throw failure(cause); }
  }
  close(): void { this.client.destroy(); }
}
