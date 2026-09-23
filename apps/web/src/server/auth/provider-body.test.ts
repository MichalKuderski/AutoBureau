// @vitest-environment node
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "vitest";
import { discardProviderBody, MAX_PROVIDER_RESPONSE_BYTES, ProviderBodyError, readProviderJson } from "./provider-body";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const signal = (): AbortSignal => new AbortController().signal;

function streamed(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

describe("provider bodies are bounded and contain no diagnostic payload", () => {
  it("parses valid JSON and releases its reader and abort listener", async () => {
    const response = new Response('{"ok":true}');
    const s = signal();
    assert.deepEqual(await readProviderJson(response, s), { ok: true });
    assert.equal(response.body?.locked, false);
    assert.equal(getEventListeners(s, "abort").length, 0);
  });

  it("decodes UTF-8 characters split across chunks", async () => {
    const bytes = encode('{"name":"Michał 😀"}');
    assert.deepEqual(await readProviderJson(streamed(Array.from(bytes, (byte) => Uint8Array.of(byte))), signal()), { name: "Michał 😀" });
  });

  it("accepts exactly the byte limit", async () => {
    const text = '"' + "a".repeat(MAX_PROVIDER_RESPONSE_BYTES - 2) + '"';
    assert.equal((await readProviderJson(new Response(text), signal()) as string).length, MAX_PROVIDER_RESPONSE_BYTES - 2);
  });

  it("rejects one byte over the limit and cancels the unread stream", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encode("a".repeat(MAX_PROVIDER_RESPONSE_BYTES + 1))); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(readProviderJson(response, signal()), { failure: "invalid-response" });
    assert.equal(cancelled, true);
    assert.equal(response.body?.locked, false);
  });

  it("counts bytes, not JavaScript character length", async () => {
    const text = JSON.stringify("ł".repeat(MAX_PROVIDER_RESPONSE_BYTES / 2));
    assert.ok(text.length < MAX_PROVIDER_RESPONSE_BYTES);
    await assert.rejects(readProviderJson(new Response(text), signal()), { failure: "invalid-response" });
  });

  it("enforces the limit across chunks even with a misleading Content-Length", async () => {
    const response = streamed([encode('"'), encode("a".repeat(MAX_PROVIDER_RESPONSE_BYTES - 1)), encode('"')]);
    response.headers.set("content-length", "1");
    await assert.rejects(readProviderJson(response, signal()), { failure: "invalid-response" });
  });

  for (const [name, bytes] of [
    ["invalid JSON", encode("PRIVATE_CANARY")],
    ["truncated JSON", encode('{"token":"PRIVATE_CANARY"')],
    ["invalid UTF-8", Uint8Array.of(34, 0xff, 34)],
    ["truncated UTF-8", Uint8Array.of(34, 0xe2)],
    ["empty body", new Uint8Array()],
  ] as const) {
    it(`rejects ${name} without retaining its contents`, async () => {
      const s = signal();
      await assert.rejects(readProviderJson(streamed([bytes]), s), (error: unknown) => {
        assert.ok(error instanceof ProviderBodyError);
        assert.equal(error.failure, "invalid-response");
        assert.equal("cause" in error, false);
        assert.ok(!JSON.stringify(error).includes("PRIVATE_CANARY"));
        assert.ok(!String(error).includes("PRIVATE_CANARY"));
        return true;
      });
      assert.equal(getEventListeners(s, "abort").length, 0);
    });
  }

  it("classifies a broken stream as transport failure and discards its exception", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("PRIVATE_CANARY")); },
    }));
    await assert.rejects(readProviderJson(response, signal()), (error: unknown) => {
      assert.ok(error instanceof ProviderBodyError);
      assert.equal(error.failure, "network");
      assert.equal("cause" in error, false);
      assert.ok(!String(error).includes("PRIVATE_CANARY"));
      return true;
    });
    assert.equal(response.body?.locked, false);
  });

  it("bounds a stalled body even if the stream ignores fetch's AbortSignal", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(encode('{"token":"')); },
      cancel() { cancelled = true; return new Promise<void>(() => undefined); },
    }));
    const timer = setTimeout(() => controller.abort(), 25);
    try {
      await assert.rejects(readProviderJson(response, controller.signal), { failure: "timeout" });
      assert.equal(cancelled, true);
      assert.equal(response.body?.locked, false);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects an already-aborted read and cancels its body", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
    const controller = new AbortController();
    controller.abort(new Error("PRIVATE_CANARY"));
    await assert.rejects(readProviderJson(response, controller.signal), { failure: "timeout" });
    assert.equal(cancelled, true);
  });

  it("refuses a missing body instead of fabricating an empty object", async () => {
    await assert.rejects(readProviderJson(new Response(null, { status: 204 }), signal()), { failure: "invalid-response" });
  });

  it("refuses a locked body without throwing a native exception", async () => {
    const response = new Response("{}");
    const reader = response.body!.getReader();
    try {
      await assert.rejects(readProviderJson(response, signal()), { failure: "invalid-response" });
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it("does not wait for an unused body's cancellation acknowledgement", () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; return new Promise<void>(() => undefined); },
    }));
    discardProviderBody(response);
    assert.equal(cancelled, true);
    discardProviderBody(new Response(null, { status: 204 }));
  });
});

describe("bounded chunk work", () => {
  it("refuses excessive empty chunks even when their total byte size is zero", async () => {
    let remaining = MAX_PROVIDER_RESPONSE_BYTES + 4;
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining-- > 0) controller.enqueue(new Uint8Array());
        else { controller.enqueue(encode("{}")); controller.close(); }
      },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(readProviderJson(response, signal()), { failure: "invalid-response" });
    assert.equal(cancelled, true);
    assert.equal(response.body?.locked, false);
  });
  it("still admits byte-by-byte data at the byte limit", async () => {
    const data = encode('"' + 'a'.repeat(MAX_PROVIDER_RESPONSE_BYTES - 2) + '"');
    let position = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if(position < data.length) controller.enqueue(data.subarray(position, ++position));
        else controller.close();
      },
    }));
    assert.equal((await readProviderJson(response, signal()) as string).length, MAX_PROVIDER_RESPONSE_BYTES - 2);
  });
  it("does not keep an abort listener after overflow", async () => {
    const s=signal();
    await assert.rejects(readProviderJson(new Response('a'.repeat(MAX_PROVIDER_RESPONSE_BYTES+1)),s));
    assert.equal(getEventListeners(s,'abort').length,0);
  });
});
