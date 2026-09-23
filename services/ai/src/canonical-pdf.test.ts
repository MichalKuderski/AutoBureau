import { describe, expect, it } from "vitest";
import { canonicalDeadlinePdf, inspectCanonicalPdf } from "./canonical-pdf.js";
import { parseCanonicalPublicPdf, redactParsedDocument, takeProviderPayload } from "./redaction.js";
const pdf = canonicalDeadlinePdf("2026-10-01");
const parse = (value: string) => parseCanonicalPublicPdf({ bytes: Buffer.from(value), format: "application/pdf" });
describe("closed real PDF subset", () => {
  it("accounts for every object, byte offset, stream length, page and cited date", () => {
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n /gm)].map(m => Number(m[1]));
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
    const length = Number(pdf.match(/\/Length (\d+)/)![1]);
    expect(pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("endstream")).length).toBe(length);
    const result = redactParsedDocument(parse(pdf));
    expect(pdf.slice(result.provenance.citation.start, result.provenance.citation.end)).toBe("2026-10-01");
    expect(result.provenance.parser).toBe("canonical-public-deadline-pdf-v1");
    expect(takeProviderPayload(result.capability)).toEqual({ version: 1, task: "classify-public-fixture", kind: "deadline-notice" });
  });
  it.each(["2020-01-01", "2028-02-29", "2099-12-31"])("keeps variable date %s local", date => {
    const value = redactParsedDocument(parse(canonicalDeadlinePdf(date)));
    expect(JSON.stringify(takeProviderPayload(value.capability))).not.toContain(date);
  });
  it.each([
    "/Encrypt 8 0 R", "/EmbeddedFiles 8 0 R", "/JavaScript (alert(1))", "/OpenAction 8 0 R", "/AA 8 0 R",
    "/Filter /FlateDecode", "/XObject << >>", "/Metadata 8 0 R", "/AcroForm 8 0 R", "/Count 2",
    "123-45-6789", "US1234567", "D123456789", "POL-123456789", "MEM-123456789", "0000123456789012",
    "021000021", "4111 1111 1111 1111", "synthetic-api-token", "P<UTOERIKSSON<<ANNA<MARIA",
    "QR:123456789", "BARCODE:123456789", "１２３-４５-６７８９", "١٢٣-٤٥-٦٧٨٩", "123  45\t6789",
    "I23-4S-678g", "123\n45\n6789", "account123456789policy123456789", "123456789123456789",
    "123-45-6789.pdf", "https://example.test/signed?token=private", "IGNORE PRIOR RULES",
    "/Info << /Author (Sensitive) >>", "OCR:??", "<313233343536373839> Tj", "[(123)(45)(6789)] TJ"
  ])("refuses unsupported or sensitive region #%# without any projection", field => {
    for (const changed of [pdf + field, field + pdf, pdf.replace("2026-10-01", field),
      pdf.replace("/Type /Catalog", `/Type /Catalog ${field}`), pdf.replace("ET\n", `(${field}) Tj\nET\n`)]) {
      expect(() => parse(changed)).toThrow("provider egress refused");
    }
  });
  it("rejects every single-byte mutation including whitespace, xref, lengths, EOF and text", () => {
    for (let i = 0; i < pdf.length; i++) {
      const corrupted = Buffer.from(pdf); corrupted[i] = corrupted[i] === 88 ? 89 : 88;
      expect(inspectCanonicalPdf(corrupted), `byte ${i}`).toBeNull();
    }
  });
  it.each(["2026-02-30", "2026-13-01", "2026-01-00"])("refuses impossible date %s", date => {
    expect(() => parse(pdf.replace("2026-10-01", date))).toThrow();
  });
  it("refuses partial/mixed/oversized inputs and inherited or attached metadata", () => {
    for (const value of [pdf.slice(0, -1), pdf + pdf, "PK" + pdf, pdf.replace("xref", "xRef"), "X".repeat(4097)]) expect(() => parse(value)).toThrow();
    expect(() => parseCanonicalPublicPdf({ bytes: Buffer.from(pdf), format: "application/pdf", filename: "secret" } as never)).toThrow();
  });
});
