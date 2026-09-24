import { UuidSchema } from "@autobureau/contracts";
import { authenticated } from "@/server/http/route";
import { HttpProblem } from "@/server/http/problem";
import { exportArchiveStorage } from "@/server/privacy/export-storage";

/** Recent-auth download. Each call re-authenticates the whole ciphertext and rechecks the
 * owner, intent expiry, revocation and deletion fence; no reusable link is minted. */
export const GET = authenticated({ requires: "household.export" }, async ({ request, ctx, db }) => {
  const parts = new URL(request.url).pathname.split("/");
  const hh = UuidSchema.safeParse(parts.at(-3)), requestId = UuidSchema.safeParse(parts.at(-1));
  if (!hh.success || hh.data !== ctx.householdId || !requestId.success) throw new HttpProblem("not-found", "That export was not found.");
  const storage = exportArchiveStorage();
  if (!storage) throw new HttpProblem("unavailable", "Export isn't available on this deployment yet.");
  let archive: Buffer;
  try { archive = await storage.download(db, hh.data, requestId.data); } catch { throw new HttpProblem("not-found", "That export was not found."); }
  return new Response(Uint8Array.from(archive), { headers: { "content-type": "application/zip", "referrer-policy": "no-referrer",
    "content-disposition": `attachment; filename="pellum-export-${requestId.data.slice(0, 8)}.zip"` } });
});
export const dynamic = "force-dynamic";
