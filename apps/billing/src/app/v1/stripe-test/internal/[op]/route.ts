import { serve } from "../../../../../server/runtime";

/** Signed web-runtime requests about an intent the owner already wrote (see internal-signature). */
export const POST = async (request: Request, { params }: { params: Promise<{ op: string }> }) => {
  const { op } = await params;
  return serve(rt => rt.internal(request, op));
};
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
