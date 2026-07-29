/**
 * Server-only entry point (`@autobureau/contracts/node`).
 *
 * Canonicalization is pure, but `payloadSha256Hex` needs a synchronous digest, which
 * only Node provides. Keeping it here means the approval-hash implementation stays
 * on the server where the executor verifies it (doc 04 §6) and never inflates the
 * client bundle.
 */
export { canonicalize, payloadSha256Hex, CanonicalizationError } from "./canonical.js";
