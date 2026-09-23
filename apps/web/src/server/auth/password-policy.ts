import { createHash } from "node:crypto";
import zxcvbn from "zxcvbn";
import { discardProviderBody, readProviderText } from "../http/provider-body";

export type PasswordVerdict = "allowed" | "weak" | "breached" | "unavailable";
/** Local strength evaluation precedes network I/O. SHA-1 is ONLY the public range
 * protocol, never password storage. No full password/hash, identifier or caller
 * header reaches the adapter. Hash prefixes still permit dictionary inference;
 * this protocol is disclosure minimization, not mathematical non-reconstruction.
 * One check at submit time, never per keystroke. No route activates it yet. */
export function createPasswordPolicy(fetchImpl: typeof fetch = fetch) {
  return async (password: string): Promise<PasswordVerdict> => {
    // Bound synchronous estimator work. Do not trim or normalize a password: the
    // tested bytes must be exactly the bytes eventually supplied to Auth.
    if (typeof password !== "string" || password.length < 8 || password.length > 128 || Array.from(password).some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127)) return "weak";
    try { if (zxcvbn(password, ["pellum", "autobureau"]).score < 3) return "weak"; }
    catch { return "unavailable"; }
    const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const signal = AbortSignal.timeout(3000);
    let response: Response | undefined;
    let abort = () => undefined as void;
    const timedOut = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error("Password policy unavailable"));
      signal.addEventListener("abort", abort, { once:true });
    });
    try {
      response = await Promise.race([fetchImpl(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
        method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
        headers: { "Add-Padding": "true", "User-Agent": "Pellum-password-policy", Accept: "text/plain" },
      }).then(r => { if(signal.aborted) { discardProviderBody(r); throw new Error("Password policy unavailable"); } return r; }), timedOut]);
      if (response.status !== 200) { discardProviderBody(response); return "unavailable"; }
      const body = await readProviderText(response, signal);
      const lines = body.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      if (lines.length < 1 || lines.length > 1600) return "unavailable";
      const seen = new Set<string>(); let breached = false;
      for (const line of lines) {
        const match = /^([A-F0-9]{35}):([0-9]{1,12})$/.exec(line);
        if (!match || seen.has(match[1]!)) return "unavailable";
        seen.add(match[1]!);
        // Zero-count padding does not indicate a breach. Validate the ENTIRE
        // response before trusting absence, including rows after a match.
        if (match[1] === hash.slice(5) && Number(match[2]) > 0) breached = true;
      }
      return breached ? "breached" : "allowed";
    } catch { return "unavailable"; } // Never propagate provider body, URL or hash.
    finally { signal.removeEventListener("abort", abort); }
  };
}
