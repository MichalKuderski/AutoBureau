import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerSpec, verifyScannerContainer, sniffScannerType, runSandboxScanner, localDockerRuntime, SANDBOX_LIMITS } from './scanner-sandbox.mjs';
const release = { image: `sha256:${'a'.repeat(64)}`, engine: `sha256:${'b'.repeat(64)}`, signatures: `sha256:${'c'.repeat(64)}` };
const nonce = '00000000-0000-4000-8000-000000000001';
function inspected(spec) { return { Image: spec.image, Name: `/${spec.name}`, State: { Running: false }, Mounts: [],
  Config: { Labels: { 'pellum.scanner.engine': spec.engine, 'pellum.scanner.signatures': spec.signatures }, Image: spec.image, User: '65532:65532', Entrypoint: ['/scanner/scan'], Cmd: [], Env: ['LANG=C', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent'], Healthcheck: { Test: ['NONE'] } },
  HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges=true'],
    Memory: SANDBOX_LIMITS.memory, MemorySwap: SANDBOX_LIMITS.memory, NanoCpus: SANDBOX_LIMITS.nanoCpus, PidsLimit: 16,
    IpcMode: 'none', LogConfig: { Type: 'none' }, RestartPolicy: { Name: 'no' },
    Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=67108864,mode=700,uid=65532,gid=65532' },
    Ulimits: [{ Name: 'nofile', Hard: 64, Soft: 64 }, { Name: 'core', Hard: 0, Soft: 0 }] } }; }
test('scanner configuration pins image/engine/signatures and never supplies host mounts or ambient env', () => {
  const s = scannerSpec(release, nonce);
  assert.ok(s.args.includes('--pull=never')); assert.ok(s.args.includes('--read-only'));
  assert.equal(s.args.some(x => /privileged|unconfined|env-file|volume=|mount=/.test(x)), false);
  for (const invalid of [{ ...release, image: 'scanner:latest' }, { ...release, signatures: '' }, { ...release, credentials: 'canary' }]) assert.throws(() => scannerSpec(invalid, nonce));
  assert.throws(() => localDockerRuntime('tcp://example.test:2375'));
  assert.throws(() => localDockerRuntime('unix:///tmp/local.sock', '/tmp/input-executable'));
});
test('magic-byte admission precedes all container work; it does not claim deep format validity', () => {
  assert.equal(sniffScannerType(Buffer.from('%PDF-1.7\npublic fixture\n%%EOF')), 'application/pdf');
  assert.equal(sniffScannerType(Buffer.from('filename.pdf')), null);
  assert.equal(sniffScannerType(Buffer.from('%PDF-1.7\ntruncated')), null);
  assert.equal(sniffScannerType(Buffer.alloc(SANDBOX_LIMITS.input + 1)), null);
});
for (const [field, value] of Object.entries({ NetworkMode: 'host', ReadonlyRootfs: false, Privileged: true,
  CapDrop: [], CapAdd: ['NET_ADMIN'], SecurityOpt: ['seccomp=unconfined'], Memory: 0, MemorySwap: -1, NanoCpus: 0,
  PidsLimit: 0, IpcMode: 'host', PidMode: 'host', UsernsMode: 'host', Binds: ['/tmp:/tmp'], Devices: [{}],
  DeviceRequests: [{}], VolumesFrom: ['other'], ExtraHosts: ['host:1.2.3.4'], LogConfig: { Type: 'json-file' },
  RestartPolicy: { Name: 'always' }, Tmpfs: {}, Ulimits: [] })) {
  test(`effective ${field} weakening is refused before input delivery`, () => {
    const spec = scannerSpec(release, nonce), valueBefore = inspected(spec); verifyScannerContainer(valueBefore, spec);
    valueBefore.HostConfig[field] = value; assert.throws(() => verifyScannerContainer(valueBefore, spec));
  });
}
test('effective root identity, inherited secrets, command overrides and mount defaults are refused', () => {
  const spec = scannerSpec(release, nonce);
  for (const edit of [x => { x.Config.Labels['pellum.scanner.engine'] = release.image; }, x => { x.Config.Labels = {}; }, x => { x.Config.User = '0'; }, x => { x.Config.Env.push('DATABASE_URL=canary'); },
    x => { x.Config.Cmd = ['sh']; }, x => { x.Mounts = [{}]; }, x => { x.Config.Volumes = { '/data': {} }; },
    x => { x.Image = release.engine; }, x => { x.State.Running = true; }]) {
    const v = inspected(spec); edit(v); assert.throws(() => verifyScannerContainer(v, spec));
  }
});
const request = { nonce, bytes: Buffer.from('%PDF-1.7\npublic fixture\n%%EOF') };
function runtime(override = {}) {
  const calls = [];
  return { calls, create: async () => { calls.push('create'); }, inspect: async s => { calls.push('inspect'); return inspected(s); },
    run: async (_s, input) => { calls.push('run'); assert.equal(JSON.parse(input).nonce, nonce); return Buffer.from('{}'); },
    destroy: async () => { calls.push('destroy'); }, ...override };
}
test('container lifecycle inspects before stdin and destroys before returning any reply', async () => {
  const r = runtime(); assert.deepEqual(await runSandboxScanner(r, release, request, new AbortController().signal), Buffer.from('{}'));
  assert.deepEqual(r.calls, ['create', 'inspect', 'run', 'destroy']);
});
test('failed inspection never delivers stdin and still destroys task container', async () => {
  const r = runtime({ inspect: async () => ({}) }); await assert.rejects(runSandboxScanner(r, release, request, new AbortController().signal));
  assert.deepEqual(r.calls, ['create', 'destroy']);
});
test('oversize stdout or unproven cleanup cannot produce a scan reply', async () => {
  for (const r of [runtime({ run: async () => Buffer.alloc(1025) }), runtime({ destroy: async () => { throw new Error('cleanup'); } })]) {
    await assert.rejects(runSandboxScanner(r, release, request, new AbortController().signal));
  }
});
test('uncooperative scan is bounded and triggers complete container cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = runtime({ run: async () => new Promise(() => {}) });
  const p = assert.rejects(runSandboxScanner(r, release, request, new AbortController().signal), /deadline/);
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(SANDBOX_LIMITS.wallMs + 1); await p;
  assert.ok(r.calls.includes('destroy'));
});
test('uncooperative cleanup also has a hard broker deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started; const ready = new Promise(resolve => { started = resolve; });
  const r = runtime({ destroy: () => { started(); return new Promise(() => {}); } });
  const p = assert.rejects(runSandboxScanner(r, release, request, new AbortController().signal), /cleanup unproven/);
  await ready; t.mock.timers.tick(SANDBOX_LIMITS.cleanupMs + 1); await p;
});
test('scanner telemetry contains only bounded stage and duration, never fixture/runtime values',async()=>{
 const events=[];await runSandboxScanner(runtime(),release,request,new AbortController().signal,e=>events.push(e));
 assert.deepEqual(events.map(e=>e.phase),['queued','created','isolation-verified','scan-start-requested','scan-returned','cleanup-started','cleanup-complete']);
 for(const e of events){assert.deepEqual(Object.keys(e).sort(),['elapsedMs','phase']);assert.ok(Object.isFrozen(e));assert.ok(Number.isSafeInteger(e.elapsedMs)&&e.elapsedMs>=0);}
});
test('telemetry failure cannot bypass an isolation rejection or prevent cleanup',async()=>{
 const r=runtime({inspect:async()=>({})});await assert.rejects(runSandboxScanner(r,release,request,new AbortController().signal,()=>{throw new Error('synthetic telemetry failure');}),/isolation refused/);
});
test('cleanup failure is explicitly classified without reflecting runtime errors',async()=>{
 const events=[];const r=runtime({destroy:async()=>{throw new Error('sensitive path must not escape');}});
 await assert.rejects(runSandboxScanner(r,release,request,new AbortController().signal,e=>events.push(e)),/^Error: scanner cleanup unproven$/);
 assert.equal(events.at(-1).phase,'cleanup-failed');assert.equal(JSON.stringify(events).includes('sensitive'),false);
});
