/** Local-only OCI scanner broker. No application imports or hosted activation.
 * The broker holds local runtime authority; the scanner receives stdin only.
 * A pinned, independently reviewed image is required; this module never pulls one. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export const SANDBOX_LIMITS = Object.freeze({ memory: 3072 * 1024 * 1024, tmp: 64 * 1024 * 1024,
  nanoCpus: 1_000_000_000, pids: 16, fds: 64, input: 25 * 1024 * 1024, output: 1024, wallMs: 40000, cleanupMs: 5000 });
const env = Object.freeze(['LANG=C', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent']);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export function scannerSpec(release, nonce) {
  if (!release || Object.keys(release).sort().join() !== 'engine,image,signatures'
    || ![release.image, release.engine, release.signatures].every(digest)
    || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('scanner configuration refused');
  return Object.freeze({ name: `pellum-scan-${nonce}`, image: release.image,
    engine: release.engine, signatures: release.signatures,
    args: Object.freeze(['create', '--pull=never', '--name', `pellum-scan-${nonce}`, '--interactive',
      '--network=none', '--read-only', '--user=65532:65532', '--cap-drop=ALL',
      '--security-opt=no-new-privileges=true', '--cpus=1', '--memory=3072m', '--memory-swap=3072m',
      '--pids-limit=16', '--ulimit=nofile=64:64', '--ulimit=core=0:0', '--ipc=none',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=700,uid=65532,gid=65532',
      '--no-healthcheck', '--log-driver=none', '--restart=no',
      ...env.flatMap(value => ['--env', value]), '--entrypoint=/scanner/scan', release.image]) });
}
/** Read effective engine state BEFORE exposing stdin; source flags alone are not proof. */
export function verifyScannerContainer(value, spec) {
  const h = value?.HostConfig, c = value?.Config;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!h || !c || value.Image !== spec.image || c.Image !== spec.image
    || value.Name !== `/${spec.name}` || value.State?.Running !== false
    || c.User !== '65532:65532' || !equal(c.Entrypoint, ['/scanner/scan']) || (c.Cmd?.length ?? 0) !== 0
    || !equal([...(c.Env ?? [])].sort(), [...env].sort()) || Object.keys(c.Volumes ?? {}).length
    || c.Healthcheck?.Test?.[0] !== 'NONE'
    || c.Labels?.['pellum.scanner.engine'] !== spec.engine || c.Labels?.['pellum.scanner.signatures'] !== spec.signatures
    || h.NetworkMode !== 'none' || h.ReadonlyRootfs !== true || h.Privileged !== false
    || !equal(h.CapDrop, ['ALL']) || (h.CapAdd?.length ?? 0)
    || !equal(h.SecurityOpt, ['no-new-privileges=true'])
    || h.Memory !== SANDBOX_LIMITS.memory || h.MemorySwap !== SANDBOX_LIMITS.memory
    || h.NanoCpus !== SANDBOX_LIMITS.nanoCpus || h.PidsLimit !== SANDBOX_LIMITS.pids
    || h.IpcMode !== 'none' || (h.PidMode ?? '') !== '' || (h.UsernsMode ?? '') !== ''
    || (h.Binds?.length ?? 0) || (h.Devices?.length ?? 0) || (h.DeviceRequests?.length ?? 0)
    || (h.VolumesFrom?.length ?? 0) || (h.ExtraHosts?.length ?? 0) || (value.Mounts?.length ?? 0)
    || h.LogConfig?.Type !== 'none' || h.RestartPolicy?.Name !== 'no'
    || !equal(h.Tmpfs, { '/tmp': 'rw,noexec,nosuid,nodev,size=67108864,mode=700,uid=65532,gid=65532' })
    || !equal([...(h.Ulimits ?? [])].sort((a,b) => a.Name.localeCompare(b.Name)), [{ Name: 'core', Hard: 0, Soft: 0 }, { Name: 'nofile', Hard: 64, Soft: 64 }])) {
    throw new Error('scanner isolation refused');
  }
}
export function sniffScannerType(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > SANDBOX_LIMITS.input) return null;
  const b = Buffer.from(bytes);
  if (b.subarray(0, 5).equals(Buffer.from('%PDF-')) && b.subarray(-6).toString('ascii').trim() === '%%EOF') return 'application/pdf';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.length > 4 && b[0] === 255 && b[1] === 216 && b[2] === 255 && b.at(-2) === 255 && b.at(-1) === 217) return 'image/jpeg';
  return null;
}
/** Provider-neutral lifecycle. Every exit requires full-container destruction;
 * cleanup uncertainty never yields a scan reply. No input-selected executable. */
export async function runSandboxScanner(runtime, release, request, signal, observe = () => {}) {
  const started = performance.now();
  const emit = phase => { try { observe(Object.freeze({ phase, elapsedMs: Math.max(0, Math.round(performance.now()-started)) })); } catch { /* Telemetry cannot grant or deny a scan verdict. */ } };
  if (!sniffScannerType(request?.bytes) || signal.aborted) throw new Error('scanner input refused');
  emit("queued");
  const spec = scannerSpec(release, randomUUID());
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  let timer, result;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { emit("watchdog-deadline"); abort(); reject(new Error('scanner deadline')); }, SANDBOX_LIMITS.wallMs); });
    const work = async () => {
      await runtime.create(spec, controller.signal);
      emit("created");
      verifyScannerContainer(await runtime.inspect(spec, controller.signal), spec);
      emit("isolation-verified");
      if (controller.signal.aborted) throw new Error('scanner deadline');
      // This marks a start request, not proof the engine began scanning.
      emit("scan-start-requested");
      const raw = await runtime.run(spec, Buffer.from(JSON.stringify({ version: 2, nonce: request.nonce,
        data: Buffer.from(request.bytes).toString('base64'), engine: spec.engine, signatures: spec.signatures, sandbox: spec.image })), controller.signal);
      if (!(raw instanceof Uint8Array) || raw.byteLength > SANDBOX_LIMITS.output || controller.signal.aborted) throw new Error('scanner output refused');
      emit("scan-returned");
      return raw;
    };
    result = await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort);
    await destroyScanner(runtime, spec, emit);
  }
  if (signal.aborted) { emit('caller-cancelled'); throw new Error('scanner cancelled'); }
  return result;
}

async function destroyScanner(runtime, spec, emit) {
  emit("cleanup-started");
    let cleanupTimer;
    try {
      await Promise.race([runtime.destroy(spec, AbortSignal.timeout(SANDBOX_LIMITS.cleanupMs)),
        new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('scanner cleanup unproven')), SANDBOX_LIMITS.cleanupMs); })]);
      emit("cleanup-complete");
    } catch { emit("cleanup-failed"); throw new Error("scanner cleanup unproven"); }
    finally { clearTimeout(cleanupTimer); }
}

/** Fixed local socket only. No shell, inherited environment, host mount or registry
 * authentication. SIGKILL targets the complete local CLI process group on timeout;
 * rm --force targets the entire task container, not just its attached client. */
export function localDockerRuntime(socket, binary = '/usr/local/bin/docker') {
  if (!/^unix:\/\/[A-Za-z0-9_./-]+\.sock$/.test(socket)
    || !['/usr/local/bin/docker', '/usr/bin/docker'].includes(binary)) throw new Error('local runtime refused');
  const run = (args, input, signal, cap) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('scanner deadline')); return; }
    const child = spawn(binary, ['--host', socket, ...args], { detached: true, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C' }, stdio: ['pipe', 'pipe', 'ignore'] });
    let size = 0, failed = false; const chunks = [];
    const kill = () => { failed = true; if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process already reaped */ } } };
    signal.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > cap) kill(); else chunks.push(chunk); });
    child.on('error', () => { signal.removeEventListener('abort', kill); reject(new Error('scanner runtime unavailable')); });
    child.on('close', code => { signal.removeEventListener('abort', kill); if (code !== 0 || failed || signal.aborted) reject(new Error('scanner runtime failed')); else resolve(Buffer.concat(chunks)); });
    child.stdin.on('error', kill); child.stdin.end(input);
  });
  return {
    create: async (spec, signal) => { await run(spec.args, undefined, signal, 128); },
    inspect: async (spec, signal) => JSON.parse((await run(['inspect', spec.name], undefined, signal, 64 * 1024)).toString())[0],
    run: async (spec, input, signal) => {
      const raw = await run(['start', '--attach', '--interactive', spec.name], input, signal, SANDBOX_LIMITS.output);
      const state = JSON.parse((await run(['inspect', '--format', '{{json .State}}', spec.name], undefined, signal, 2048)).toString());
      if (state.Running !== false || state.ExitCode !== 0 || state.OOMKilled !== false || state.Dead !== false) throw new Error('scanner runtime failed');
      return raw;
    },
    destroy: async (spec, signal) => {
      await run(['rm', '--force', '--volumes', spec.name], undefined, signal, 128);
      const remaining = await run(['container', 'ls', '--all', '--filter', `name=^/${spec.name}$`, '--format', '{{.Names}}'], undefined, signal, 128);
      if (remaining.toString().trim()) throw new Error('scanner cleanup unproven');
    },
  };
}
