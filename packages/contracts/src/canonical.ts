import { createHash } from "node:crypto";

/**
 * Canonical JSON — RFC 8785 (JCS) profile for AutoBureau payload hashing.
 *
 * Used wherever a payload hash must be reproducible across runtimes
 * (TypeScript executor ↔ future Python drafting side): approval payloads
 * (review amendment A6/F-07), idempotent event dedupe keys, export manifests.
 *
 * PROFILE CONSTRAINT (deliberate, narrower than full JCS):
 * numbers MUST be safe integers. Floats, NaN, ±Infinity, -0 normalization
 * aside, and unsafe-range integers are rejected rather than serialized.
 * Money is integer cents everywhere by contract (PRD §12), so no domain
 * payload legitimately contains a float; rejecting instead of implementing
 * ECMAScript float formatting removes the entire cross-runtime
 * number-formatting bug class. Cross-runtime implementations must enforce
 * the same constraint. Test vectors: ../test-vectors/canonical.json
 */

export class CanonicalizationError extends Error {
  override name = "CanonicalizationError";
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(
          `numbers must be safe integers (got ${String(value)}); represent money as cents, decimals as scaled ints or strings`,
        );
      }
      return Object.is(value, -0) ? "0" : String(value);
    }
    case "string":
      // JSON.stringify string escaping conforms to JCS (shortest-form escapes).
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalize(v)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError(
          "only plain objects can be canonicalized (no class instances, Dates, Maps)",
        );
      }
      // RFC 8785: property names sorted by UTF-16 code units — JS default sort.
      const keys = Object.keys(value as Record<string, unknown>).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) {
          // Silently dropping undefined (JSON.stringify behavior) would let two
          // semantically different payloads hash identically. Reject instead.
          throw new CanonicalizationError(`undefined value at key "${key}"`);
        }
        parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported type: ${typeof value}`);
  }
}

/** Lowercase hex SHA-256 of the canonical form — the wire format of `payload_sha256`. */
export function payloadSha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
