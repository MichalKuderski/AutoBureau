import { expect, it } from "vitest";
import { createReadScheduler, dashboardReadScheduler } from "./read-scheduler";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it("advances FIFO after success/failure, while cancelled queued work never starts", async () => {
  const run = createReadScheduler(), hold = deferred(), signal = new AbortController().signal, cancel = new AbortController();
  const order: number[] = [];
  const a = run(signal, async () => { order.push(1); await hold.promise; throw new Error("failure"); }).catch(() => undefined);
  const b = run(cancel.signal, async () => { order.push(2); }).catch(e => e.name);
  const c = run(signal, async () => { order.push(3); });
  await Promise.resolve(); expect(order).toEqual([1]); cancel.abort(); expect(await b).toBe("AbortError");
  hold.resolve(); await Promise.all([a,c]); expect(order).toEqual([1,3]);
});
it("does not release an active aborted task before its transport settles", async () => {
  const run = createReadScheduler(), hold = deferred(), cancel = new AbortController(); let started = false;
  const a = run(cancel.signal, () => hold.promise); await Promise.resolve(); cancel.abort();
  const b = run(new AbortController().signal, async () => { started = true; }); await Promise.resolve();
  expect(started).toBe(false); hold.resolve(); await Promise.all([a,b]); expect(started).toBe(true);
});
it("bounds the queue and shares only within a QueryClient", async () => {
  const client = {}, run = dashboardReadScheduler(client), hold = deferred(), signal = new AbortController().signal;
  expect(dashboardReadScheduler(client)).toBe(run); expect(dashboardReadScheduler({})).not.toBe(run);
  const active = run(signal, () => hold.promise), queued = Array.from({ length:32 }, () => run(signal, async () => 1));
  await expect(run(signal, async () => 2)).rejects.toThrow("busy"); hold.resolve(); await Promise.all([active,...queued]);
  const abort = new AbortController(); abort.abort(); await expect(run(abort.signal, async () => 1)).rejects.toMatchObject({ name:"AbortError" });
});
