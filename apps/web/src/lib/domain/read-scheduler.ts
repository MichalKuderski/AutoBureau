/** One in-flight dashboard read per QueryClient; no cache, retries or tenant selection here. */
export type ReadScheduler = <T>(signal: AbortSignal, task: () => Promise<T>) => Promise<T>;
export function createReadScheduler(): ReadScheduler {
  let active = false;
  const queue: Array<() => void> = [];
  const advance = () => { if (!active) queue.shift()?.(); };
  return <T>(signal: AbortSignal, task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const aborted = () => new DOMException("Read cancelled", "AbortError");
    if (signal.aborted) { reject(aborted()); return; }
    // Bound retained closures under pathological repeated invalidation.
    if (queue.length >= 32) { reject(new Error("Dashboard reads are busy")); return; }
    const cancel = () => {
      const at = queue.indexOf(start);
      if (at >= 0) { queue.splice(at, 1); signal.removeEventListener("abort", cancel); reject(aborted()); }
    };
    const start = () => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) { reject(aborted()); advance(); return; }
      active = true;
      // Keep the slot until the transport settles, even when the caller aborts.
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active = false; advance(); });
    };
    queue.push(start); signal.addEventListener("abort", cancel, { once: true }); advance();
  });
}
const schedulers = new WeakMap<object, ReadScheduler>();
export function dashboardReadScheduler(client: object): ReadScheduler {
  let scheduler = schedulers.get(client);
  if (!scheduler) { scheduler = createReadScheduler(); schedulers.set(client, scheduler); }
  return scheduler;
}
