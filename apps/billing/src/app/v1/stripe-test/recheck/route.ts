import { serve } from "../../../../server/runtime";

/** Scheduled missed-webhook recheck (Vercel Cron, CRON_SECRET bearer). Bounded per run. */
export const GET = (request: Request) => serve(rt => rt.recheck(request));
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
