// Synthetic protocol worker, NOT malware detection. No filesystem/network/provider
// imports; accepts exactly one public fixture. A production scanner needs a reviewed
// OS sandbox and ClamAV/type-triage implementation before any adapter is activated.
import { createHash } from 'node:crypto';
const cap = 2048;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > cap) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input);
    const bytes = Buffer.from(request.data, 'base64');
    const clean = bytes.equals(Buffer.from('%PDF-1.7\nPELLUM PUBLIC SYNTHETIC FIXTURE\ndue_date=2026-10-01\n%%EOF'));
    process.stdout.write(JSON.stringify({ version: 2, release: request.release, nonce: request.nonce,
      sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
      verdict: clean ? 'clean' : 'indeterminate', detectedType: 'application/pdf' }));
  } catch { process.exitCode = 2; }
});
