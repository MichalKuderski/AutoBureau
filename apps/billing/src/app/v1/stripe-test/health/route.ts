import { billingRuntime } from "../../../../server/runtime";

/** Readiness only: whether the gated configuration composed. Names no value or variable. */
export const GET = () => Response.json({ runtime: "billing-test", ready: billingRuntime() !== null },
  { status: billingRuntime() ? 200 : 503, headers: { "cache-control": "no-store" } });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
