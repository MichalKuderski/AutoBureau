import {createHash,X509Certificate} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Reviewed public Supabase CA for approved staging tools only. No environment/input override.
// Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
export const diagnosticCaPath=fileURLToPath(new URL('./certificates/supabase-prod-ca-2021.crt',import.meta.url));
const pemSha256='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const derSha256='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyDiagnosticCa() {
  if(!lstatSync(diagnosticCaPath).isFile())throw Error('Diagnostic CA refused');
  const pem=readFileSync(diagnosticCaPath);
  if(pem.length!==1367 || sha256(pem)!==pemSha256)throw Error('Diagnostic CA refused');
  const cert=new X509Certificate(pem),now=Date.now();
  if(!cert.ca || sha256(cert.raw)!==derSha256 ||
    !(Date.parse(cert.validFrom)<=now && now<Date.parse(cert.validTo)))throw Error('Diagnostic CA refused');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {verifyDiagnosticCa();process.stdout.write('DIAGNOSTIC_CA PASS\n');}
  catch {process.stdout.write('DIAGNOSTIC_CA FAIL\n');process.exitCode=1;}
}
