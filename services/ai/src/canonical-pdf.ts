/** A deliberately closed PDF 1.4 subset: one page, one built-in font, one
 * uncompressed stream, two literal strings, classic xref, no metadata. This is
 * not a general PDF parser. Re-serialization must account for EVERY input byte,
 * including offsets, lengths, trailer and EOF. No tolerant repair or partial parse.
 * Bounded ASCII input avoids decompressors, recursive objects, OCR and codecs. */
export const PDF_POLICY = "canonical-public-deadline-pdf-v1" as const;
export function canonicalDeadlinePdf(date: string): string {
  if (!/^20[2-9][0-9]-[0-1][0-9]-[0-3][0-9]$/.test(date)) throw new Error("Unsupported local document");
  const time = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== date) throw new Error("Unsupported local document");
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(PELLUM PUBLIC DEADLINE NOTICE) Tj\n0 -24 Td\n(Due: ${date}) Tj\nET\n`;
  const bodies = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, body] of bodies.entries()) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
export function inspectCanonicalPdf(bytes: Uint8Array): Readonly<{ date: string; start: number }> | null {
  if (!(bytes instanceof Uint8Array) || bytes.length > 4096 || bytes.length < 500 || bytes.some(b => b > 127)) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const matches = [...text.matchAll(/\(Due: (20[2-9][0-9]-[0-1][0-9]-[0-3][0-9])\) Tj/g)];
  if (matches.length !== 1) return null;
  const date = matches[0]![1]!;
  try { if (text !== canonicalDeadlinePdf(date)) return null; } catch { return null; }
  return Object.freeze({ date, start: matches[0]!.index! + 6 });
}
