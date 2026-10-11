import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalDeadlinePdf, inspectCanonicalPdf } from "@autobureau/contracts";
import { canonicalResultEvidence } from "../../src/canonical-result-evidence.js";

const pdf = Buffer.from(canonicalDeadlinePdf("2028-02-29"));
const row = { due_date: new Date("2028-02-29T00:00:00Z"), source_sha256: createHash("sha256").update(pdf).digest(),
  source_size: pdf.length, page: 1, citation_start: inspectCanonicalPdf(pdf)!.start, citation_end: inspectCanonicalPdf(pdf)!.start + 10 };
it("returns only the date and public source descriptor after exact reconstruction", () => {
  expect(canonicalResultEvidence(row)).toEqual({ kind: "public-synthetic-deadline", dueDate: "2028-02-29", page: 1 });
});
it.each([
  { due_date: new Date("2028-03-01T00:00:00Z") }, { due_date: new Date(NaN) }, { due_date: null },
  { source_sha256: createHash("sha256").update(Buffer.concat([pdf, Buffer.from("hidden")])).digest() },
  { source_sha256: null }, { source_size: pdf.length + 1 }, { page: 2 },
  { citation_start: row.citation_start + 1, citation_end: row.citation_end + 1 },
  { citation_start: 5, citation_end: 15 }, { citation_end: row.citation_end - 1 },
])("refuses forged or unavailable source evidence %#", change => {
  expect(canonicalResultEvidence({ ...row, ...change })).toBeNull();
});
