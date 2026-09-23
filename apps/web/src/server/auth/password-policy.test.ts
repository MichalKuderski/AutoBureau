// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createPasswordPolicy } from "./password-policy";
const password="Synthetic otter lantern granite 84!", hash=createHash("sha1").update(password).digest("hex").toUpperCase();
const safe=`${"A".repeat(35)}:1\r\n${"B".repeat(35)}:0\r\n`;
const response=(body=safe,status=200)=>new Response(body,{status});
afterEach(()=>vi.useRealTimers());
it("sends exactly a five-character prefix, padding and no credential/body/referrer",async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>response());expect(await createPasswordPolicy(fetcher)(password)).toBe("allowed");
 expect(fetcher).toHaveBeenCalledTimes(1);const [url,init]=fetcher.mock.calls[0]!;
 expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0,5)}`);
 expect(init).toMatchObject({method:"GET",redirect:"manual",cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",headers:{"Add-Padding":"true"}});
 expect(init?.body).toBeUndefined();const wire=JSON.stringify([url,init]);expect(wire).not.toContain(password);expect(wire).not.toContain(hash);expect(wire).not.toContain(hash.slice(5));
 expect(Object.keys(init!.headers!)).toEqual(["Add-Padding","User-Agent","Accept"]);
});
it.each(["password123!","Pellum123!","abcdefgh","a".repeat(129),"short","a\ncomplicated password with control"])("rejects weak/bounded input locally: %s",async value=>{
 const fetcher=vi.fn<typeof fetch>();expect(await createPasswordPolicy(fetcher)(value)).toBe("weak");expect(fetcher).not.toHaveBeenCalled();
});
it.each([1,23,999999999999])("refuses breached suffix with count %i",async count=>{
 expect(await createPasswordPolicy(async()=>response(`${hash.slice(5)}:${count}`))(password)).toBe("breached");
});
it("does not mistake zero-count padding for exposure",async()=>expect(await createPasswordPolicy(async()=>response(`${hash.slice(5)}:0`))(password)).toBe("allowed"));
it.each(["", "html",`${"a".repeat(35)}:1`,`${hash.slice(5)}:-1`,`${hash.slice(5)}:1.5`,`${hash.slice(5)}:9999999999999`,`${hash.slice(5)}:1\ninvalid`,safe+safe,"A".repeat(65537)])("refuses malformed/truncated/oversized range %i",async body=>{
 expect(await createPasswordPolicy(async()=>response(body))(password)).toBe("unavailable");
});
it.each([301,400,401,404,429,500,503,504])("fails closed with one attempt on %i",async status=>{
 const fetcher=vi.fn<typeof fetch>(async()=>response("private upstream",status));expect(await createPasswordPolicy(fetcher)(password)).toBe("unavailable");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("fails closed without leaking network diagnostics",async()=>{
 expect(await createPasswordPolicy(async()=>{throw new Error(password+hash);})(password)).toBe("unavailable");
});
it("bounds a stalled response stream even when its adapter ignores abort",async()=>{
 const stream=new ReadableStream<Uint8Array>({pull:()=>new Promise(()=>undefined)});
 const start=Date.now();expect(await createPasswordPolicy(async()=>new Response(stream))(password)).toBe("unavailable");expect(Date.now()-start).toBeLessThan(4500);
},5000);

it("bounds a stalled header/transport adapter even if it ignores abort",async()=>{
 const start=Date.now();expect(await createPasswordPolicy(async()=>new Promise<Response>(()=>undefined))(password)).toBe("unavailable");expect(Date.now()-start).toBeLessThan(4500);
},5000);
