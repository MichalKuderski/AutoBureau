import { serve } from "../../../../server/runtime";

/** Stripe TEST webhook: raw body, official signature verification, durable inbox. */
export const POST = (request: Request) => serve(rt => rt.webhook(request));
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
