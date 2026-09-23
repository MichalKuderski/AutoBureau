import { createHash } from "node:crypto";
import { inspectCanonicalPdf, PDF_POLICY } from "./canonical-pdf.js";

// Only the public synthetic format is supported. This is deliberately NOT a PDF,
// image, OCR, malware, or arbitrary-text parser and makes no real-document claim.
export const PUBLIC_SYNTHETIC_DOCUMENT = "PELLUM-SYNTHETIC/1\nkind=deadline-notice\norigin=public-fixture\ndue=2026-10-01\nEND\n";
const header = "PELLUM-SYNTHETIC/1\nkind=deadline-notice\norigin=public-fixture\ndue=";
declare const parsedBrand: unique symbol;
declare const redactedBrand: unique symbol;
export type ParsedDocument = Readonly<{ [parsedBrand]: true }>;
export type ProviderInput = Readonly<{ [redactedBrand]: true }>;
export interface RawDocument { readonly bytes: Uint8Array; readonly format: "pellum-public-synthetic-v1" }
interface ParsedState { sha256: string; date: string; start: number; parser: "public-synthetic-v1" | typeof PDF_POLICY }
export interface RedactionProvenance {
  readonly sourceSha256: string; readonly parser: ParsedState["parser"]; readonly policy: "closed-enums-v1";
  readonly retainedLocally: readonly ["due-date"]; readonly citation: Readonly<{ start: number; end: number }>;
}
export type ProviderPayload = Readonly<{ version: 1; task: "classify-public-fixture"; kind: "deadline-notice" }>;
const parsed = new WeakMap<object, ParsedState>();
const cleared = new WeakMap<object, ProviderPayload>();
export class DocumentBoundaryError extends Error {
  constructor() { super("Document requires local review; provider egress refused"); }
}
const deny = (): never => { throw new DocumentBoundaryError(); };
const keyOnly = (value: unknown, keys: string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)
    && Object.getOwnPropertyDescriptor(value, k)?.get === undefined);
};
/** Admission is whole-format parsing, not searching for identifiers with regexes.
 * Any extra region, attachment, field, metadata, Unicode or partial content refuses
 * egress. The only variable field is a calendar date, kept entirely local. */
export function parsePublicSyntheticDocument(input: RawDocument): ParsedDocument {
  if (!keyOnly(input, ["bytes", "format"]) || input.format !== "pellum-public-synthetic-v1"
    || !(input.bytes instanceof Uint8Array) || input.bytes.length !== header.length + 10 + 5) return deny();
  const bytes = new Uint8Array(input.bytes);
  if (bytes.some(b => b > 127)) return deny();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.startsWith(header) || !text.endsWith("\nEND\n")) return deny();
  const date = text.slice(header.length, header.length + 10);
  if (!/^20[2-9][0-9]-[0-1][0-9]-[0-3][0-9]$/.test(date)) return deny();
  const time = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== date) return deny();
  const handle = Object.freeze({}) as ParsedDocument;
  parsed.set(handle, { sha256: createHash("sha256").update(bytes).digest("hex"), date, start: header.length, parser: "public-synthetic-v1" });
  return handle;
}
/** Real PDF syntax, intentionally only the canonical public-notice subset. Scan
 * authorization is an independent orchestration gate and cannot mint this handle. */
export function parseCanonicalPublicPdf(input: { bytes: Uint8Array; format: "application/pdf" }): ParsedDocument {
  if (!keyOnly(input, ["bytes", "format"]) || input.format !== "application/pdf" || !(input.bytes instanceof Uint8Array)
    || input.bytes.length > 4096) return deny();
  const bytes = new Uint8Array(input.bytes), state = inspectCanonicalPdf(bytes);
  if (!state) return deny();
  const handle = Object.freeze({}) as ParsedDocument;
  parsed.set(handle, { ...state, sha256: createHash("sha256").update(bytes).digest("hex"), parser: PDF_POLICY });
  return handle;
}
/** The redactor projects finite, source-independent enums only. No arbitrary text,
 * date, source hash, filename, tenant ID, URL, citation, last-four or metadata is
 * exposed to the model. Provenance stays on the trusted local side. */
export function redactParsedDocument(input: ParsedDocument): Readonly<{ capability: ProviderInput; provenance: RedactionProvenance }> {
  const state = parsed.get(input); if (!state) return deny();
  parsed.delete(input);
  const capability = Object.freeze({}) as ProviderInput;
  cleared.set(capability, Object.freeze({ version: 1, task: "classify-public-fixture", kind: "deadline-notice" }));
  const provenance: RedactionProvenance = Object.freeze({ sourceSha256: state.sha256, parser: state.parser,
    policy: "closed-enums-v1", retainedLocally: Object.freeze(["due-date"] as const),
    citation: Object.freeze({ start: state.start, end: state.start + state.date.length }) });
  return Object.freeze({ capability, provenance });
}
/** Single-use runtime capability; a cast, JSON clone or scanner verdict cannot
 * authorize egress. NOT exported as a package entry point or network endpoint. */
export function takeProviderPayload(input: ProviderInput): ProviderPayload {
  const value = cleared.get(input); if (!value) return deny();
  cleared.delete(input);
  if (!keyOnly(value, ["version", "task", "kind"]) || value.version !== 1
    || value.task !== "classify-public-fixture" || value.kind !== "deadline-notice") return deny();
  return value;
}
