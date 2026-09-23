import { z } from "zod";

/**
 * RFC 9457 problem+json — the only error shape `/v1` ever returns (doc 03 §1).
 * `type` URIs are part of the public contract: stable, documented, never renamed.
 */

export const PROBLEM_BASE = "https://autobureau.com/problems/";

export const PROBLEM_KINDS = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "payload-too-large": 413,
  "unsupported-media-type": 415,
  "cap-exceeded": 402,
  "rate-limited": 429,
  internal: 500,
  unavailable: 503,
} as const;

export type ProblemKind = keyof typeof PROBLEM_KINDS;

export const FieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(FieldErrorSchema).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
export type FieldError = z.infer<typeof FieldErrorSchema>;

export function problem(
  kind: ProblemKind,
  opts: { title?: string; detail?: string; instance?: string; errors?: FieldError[] } = {},
): ProblemDetails {
  const out: ProblemDetails = {
    type: `${PROBLEM_BASE}${kind}`,
    title: opts.title ?? defaultTitle(kind),
    status: PROBLEM_KINDS[kind],
  };
  if (opts.detail !== undefined) out.detail = opts.detail;
  if (opts.instance !== undefined) out.instance = opts.instance;
  if (opts.errors !== undefined) out.errors = opts.errors;
  return out;
}

function defaultTitle(kind: ProblemKind): string {
  switch (kind) {
    case "validation": return "The request didn't match what this endpoint expects.";
    case "unauthorized": return "Sign in to continue.";
    case "forbidden": return "You don't have access to this.";
    case "not-found": return "That wasn't found.";
    case "conflict": return "This conflicts with the current state.";
    case "payload-too-large": return "That file is too large.";
    case "unsupported-media-type": return "That file type isn't supported.";
    case "cap-exceeded": return "You've reached your plan's limit.";
    case "rate-limited": return "Too many requests — try again shortly.";
    case "internal": return "Something went wrong on our side.";
    case "unavailable": return "Temporarily unavailable — try again shortly.";
  }
}
