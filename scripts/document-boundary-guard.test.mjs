import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const covered = (schema, models) => {
  const actual = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]).sort();
  return JSON.stringify(actual) === JSON.stringify(Object.keys(models).sort());
};
test('every current Prisma model has an explicit deletion or retention category', () => {
  const plan = JSON.parse(read('docs/engineering/document-retention-coverage.json'));
  assert.equal(plan.status, 'planning-only-not-a-deletion-receipt');
  assert.equal(covered(read('packages/db/prisma/schema.prisma'), plan.models), true);
  assert.equal(covered(read('packages/db/prisma/schema.prisma') + '\nmodel ForgottenPrivateData {\n}\n', plan.models), false);
  const missing = { ...plan.models }; delete missing.OutboxEvent;
  assert.equal(covered(read('packages/db/prisma/schema.prisma'), missing), false);
});
const forbidden = source => /(?:fetch\s*\(|\b(?:require|import)\s*\(|(?:from|import)\s*["'](?:@aws-sdk|@anthropic|openai|https?:|node:(?:net|http|https|child_process|fs)))/.test(source);
test('local synthetic review has no network, filesystem, process or provider capability', () => {
  assert.equal(forbidden(read('apps/web/src/server/documents/synthetic-review.ts')), false);
  for (const weakened of ['fetch("https://example.test")', 'import x from "openai"', 'import("node:https")', 'import x from "node:fs"']) {
    assert.equal(forbidden(weakened), true);
  }
});
function sourceFiles(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${path}/${entry.name}`) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [`${path}/${entry.name}`] : []);
}
test('synthetic scan/review remains unreachable from application routes and production callers', () => {
  const violations = sourceFiles('apps/web/src').filter(path => !path.endsWith('.test.ts')
    && !path.startsWith('apps/web/src/server/documents/'))
    .filter(path => /scan-boundary|synthetic-review|synthetic-document-scanner/.test(read(path)));
  assert.deepEqual(violations, []);
});

const imports = source => [...source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map(x => x[1]).sort();
const ambient = source => /\b(?:fetch|eval|Function|WebSocket|XMLHttpRequest|require)\s*\(|\bimport\s*\(|\b(?:process|globalThis|console)\s*[.[]/.test(source);
test('provider stub and local redactor have a closed dependency graph and no ambient authority', () => {
  const names = sourceFiles('services/ai/src').filter(x => !x.endsWith('.test.ts'));
  assert.deepEqual(names.sort(), ['services/ai/src/canonical-pdf.ts', 'services/ai/src/gateway.ts', 'services/ai/src/redaction.ts']);
  const parser = read(names[0]), gateway = read(names[1]), redactor = read(names[2]);
  assert.deepEqual(imports(parser), []); assert.equal(ambient(parser), false);
  assert.deepEqual(imports(gateway), ['./redaction.js']);
  assert.deepEqual(imports(redactor), ['./canonical-pdf.js', 'node:crypto']);
  assert.equal(ambient(gateway), false); assert.equal(ambient(redactor), false);
  assert.deepEqual(JSON.parse(read('services/ai/package.json')).dependencies ?? {}, {});
  for (const source of ['fetch("https://example.test")', 'process.env.KEY', 'globalThis["fetch"]()',
    'require("node:fs")', 'import("node:https")', 'console.log(input)', 'eval(input)']) assert.equal(ambient(source), true);
  for (const dependency of ['@autobureau/db', '@aws-sdk/client-kms', 'node:fs', 'openai']) {
    assert.notDeepEqual(imports(gateway + `\nimport x from '${dependency}'`), ['./redaction.js']);
  }
});
test('provider capability is not imported by application routes, queues or request handlers', () => {
  const bad = [...sourceFiles('apps/web/src'), ...sourceFiles('packages/db/src')]
    .filter(x => !x.endsWith('.test.ts')).filter(x => /@autobureau\/ai-boundary|services\/ai|classifyWithLocalStub|takeProviderPayload/.test(read(x)));
  assert.deepEqual(bad, []);
});

// The model seam remains dependency-free. Storage's public fixture parser is a
// reviewed byte-identical copy, checked here so neither policy can drift silently.
test('storage fixture parser matches the isolated dependency-free parser exactly',()=>{
 assert.equal(read('packages/contracts/src/canonical-public-pdf.ts'),read('services/ai/src/canonical-pdf.ts'));
});
