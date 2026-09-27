import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Web → billing-runtime request authentication (ADR-020 hosted amendment).
 *
 * A dedicated shared secret, present in exactly two runtimes, signs each internal request:
 * HMAC-SHA256 over `timestamp.METHOD.path.sha256(body)`. The web runtime holds no Stripe
 * credential and the billing runtime no app_user credential; this secret only lets the web
 * ask the billing runtime to act on an intent the OWNER already wrote under the database's
 * owner guard. It is deliberately not the Vercel OIDC token: forwarding that token would let
 * the billing runtime assume every AWS role that trusts the web project.
 *
 * This module imports no provider SDK, so the web runtime may import it alone.
 */
export const INTERNAL_MAX_SKEW_SECONDS = 60;
export const INTERNAL_MAX_BODY_BYTES = 8 * 1024;
export const INTERNAL_TIMESTAMP_HEADER = "x-pellum-internal-timestamp";
export const INTERNAL_SIGNATURE_HEADER = "x-pellum-internal-signature";

/** ≥256 bits of base64url/hex text; never logged, never echoed. */
export function internalSecretOk(secret: unknown): secret is string {
  return typeof secret === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(secret);
}
const PATH = /^\/v1\/stripe-test\/internal\/[a-z-]{1,40}$/;

function mac(secret: string, timestamp: number, method: string, path: string, body: Uint8Array): Buffer {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.${digest}`, "utf8").digest();
}

export function signInternalRequest(secret: string, method: "POST", path: string, body: Uint8Array, timestamp: number): string {
  if (!internalSecretOk(secret) || !PATH.test(path) || !Number.isSafeInteger(timestamp) || body.byteLength > INTERNAL_MAX_BODY_BYTES)
    throw new Error("Internal request refused");
  return `v1=${mac(secret, timestamp, method, path, body).toString("hex")}`;
}

/** Constant-time over equal-length MACs; any malformed input is simply "not verified". */
export function verifyInternalRequest(secret: string, method: string, path: string, body: Uint8Array,
  timestampHeader: string | null, signatureHeader: string | null, nowSeconds: number): boolean {
  if (!internalSecretOk(secret) || method !== "POST" || !PATH.test(path) || body.byteLength > INTERNAL_MAX_BODY_BYTES) return false;
  if (!timestampHeader || !/^\d{1,12}$/.test(timestampHeader) || !signatureHeader || !/^v1=[a-f0-9]{64}$/.test(signatureHeader)) return false;
  const timestamp = Number(timestampHeader);
  if (Math.abs(nowSeconds - timestamp) > INTERNAL_MAX_SKEW_SECONDS) return false;
  const expected = mac(secret, timestamp, method, path, body), given = Buffer.from(signatureHeader.slice(3), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
