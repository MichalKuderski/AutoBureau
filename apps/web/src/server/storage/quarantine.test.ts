// @vitest-environment node
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { CopyObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { QuarantineStorage, StorageError, UPLOAD_MAX_BYTES, storageConfigFromEnv } from "./quarantine";
const household = "11111111-1111-4111-8111-111111111111", document = "22222222-2222-4222-8222-222222222222";
const key = `hh/${household}/upload/${document}/incoming`;
const destination = `hh/${household}/upload/${document}/sealed/33333333-3333-4333-8333-333333333333`;
const config = { endpoint: "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/s3", region: "us-west-2", bucket: "document-quarantine", accessKeyId: "synthetic-access-id", secretAccessKey: "synthetic-secret-for-local-tests-only" };
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", AUTH_ISSUER: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1", STORAGE_S3_REGION: config.region, STORAGE_QUARANTINE_BUCKET: config.bucket, STORAGE_S3_ACCESS_KEY_ID: config.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: config.secretAccessKey };
// This adapter uses only the SDK's promise overload; narrow the overloaded spy.
const mockSend = () => vi.spyOn(S3Client.prototype, "send") as unknown as Mock<(command: { input: object }) => Promise<object>>;
afterEach(() => vi.restoreAllMocks());
describe("quarantined storage capabilities", () => {
  it("binds a real SigV4 capability to exact type, size, object and 15-minute expiry without any application token", async () => {
    const storage = new QuarantineStorage(config), issuedAt = new Date("2026-09-12T12:00:00Z");
    const signed = await storage.issue({ key, mime: "application/pdf", size: 12 }, issuedAt), url = new URL(signed.url);
    expect(url.origin).toBe(new URL(config.endpoint).origin);
    expect(url.pathname).toBe(`/storage/v1/s3/${config.bucket}/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(["content-length", "content-type", "host"]);
    expect(url.searchParams.get("X-Amz-Security-Token")).toBeNull();
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.url).not.toContain(config.secretAccessKey);
    expect(signed.expiresAt.toISOString()).toBe("2026-09-12T12:15:00.000Z");
    const changed = await storage.issue({ key, mime: "application/pdf", size: 13 }, issuedAt);
    expect(new URL(changed.url).searchParams.get("X-Amz-Signature")).not.toBe(url.searchParams.get("X-Amz-Signature"));
    storage.close();
  });
  it("rejects oversized, empty, fractional, disallowed and arbitrary-path capabilities before provider I/O", async () => {
    const send = mockSend(), storage = new QuarantineStorage(config);
    for (const size of [0, -1, 1.5, UPLOAD_MAX_BYTES + 1]) await expect(storage.issue({ key, mime: "application/pdf", size })).rejects.toMatchObject({ code: "invalid-object" });
    await expect(storage.issue({ key: "../private", mime: "application/pdf", size: 1 })).rejects.toBeInstanceOf(StorageError);
    await expect(storage.issue({ key, mime: "text/html" as "application/pdf", size: 1 })).rejects.toBeInstanceOf(StorageError);
    await expect(storage.discard(key)).rejects.toBeInstanceOf(StorageError);
    expect(send).not.toHaveBeenCalled(); storage.close();
  });
  it("requires explicit credentials and a matching, non-arbitrary Supabase origin", () => {
    expect(storageConfigFromEnv(env)).toEqual(config);
    for (const issuer of ["http://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1", "https://evil.test/auth/v1", "https://user@aaaaaaaaaaaaaaaaaaaa.supabase.co/auth/v1", `${env.AUTH_ISSUER}?token=private`]) expect(() => storageConfigFromEnv({ ...env, AUTH_ISSUER: issuer })).toThrow(StorageError);
    expect(() => storageConfigFromEnv({ ...env, STORAGE_S3_SECRET_ACCESS_KEY: "" })).toThrow(StorageError);
    expect(() => storageConfigFromEnv({ ...env, STORAGE_QUARANTINE_BUCKET: "../public" })).toThrow(StorageError);
  });
  it("copies conditionally to a distinct same-document key and verifies the selected bytes' metadata", async () => {
    const send = mockSend();
    send.mockResolvedValueOnce({ ContentLength: 12, ContentType: "application/pdf", ETag: '"original-etag"' }).mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: 12, ContentType: "application/pdf" });
    const storage = new QuarantineStorage(config);
    await storage.seal({ key, mime: "application/pdf", size: 12 }, destination);
    const copy = send.mock.calls[1]?.[0];
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect(copy?.input).toMatchObject({ Key: destination, CopySource: `${config.bucket}/${key}`, CopySourceIfMatch: '"original-etag"', MetadataDirective: "REPLACE", ContentDisposition: "attachment" });
    expect(send).toHaveBeenCalledTimes(3); storage.close();
  });
  it("rejects a foreign destination and changed object size without issuing a copy", async () => {
    const send = mockSend().mockResolvedValue({ ContentLength: 13, ContentType: "application/pdf", ETag: '"etag"' });
    const storage = new QuarantineStorage(config);
    await expect(storage.seal({ key, mime: "application/pdf", size: 12 }, destination.replace(household, document))).rejects.toMatchObject({ code: "invalid-object" });
    expect(send).not.toHaveBeenCalled();
    await expect(storage.seal({ key, mime: "application/pdf", size: 12 }, destination)).rejects.toMatchObject({ code: "invalid-object" });
    expect(send).toHaveBeenCalledTimes(1); storage.close();
  });
  it("refuses a raced copy or mismatched snapshot and never retains provider error details", async () => {
    const send = mockSend();
    const head = { ContentLength: 12, ContentType: "application/pdf", ETag: '"etag"' };
    send.mockResolvedValueOnce(head).mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 }, message: "signed-url-and-secret", stack: "sensitive-stack" });
    const storage = new QuarantineStorage(config);
    try { await storage.seal({ key, mime: "application/pdf", size: 12 }, destination); expect.fail("raced copy accepted"); }
    catch (cause) { expect(cause).toMatchObject({ code: "changed" }); expect(String(cause)).not.toContain("secret"); expect(cause).not.toHaveProperty("cause"); }
    send.mockResolvedValueOnce(head).mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: 11, ContentType: "application/pdf" });
    await expect(storage.seal({ key, mime: "application/pdf", size: 12 }, destination)).rejects.toMatchObject({ code: "invalid-object" });
    storage.close();
  });
});
