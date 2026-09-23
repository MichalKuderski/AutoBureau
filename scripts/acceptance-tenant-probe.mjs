const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A missing foreign fixture must never turn a cross-tenant probe into an own-tenant read. */
export async function probeForeignHousehold(request, { ownId, foreignId, foreignReady, cookie }) {
  if (!foreignReady || typeof ownId !== 'string' || typeof foreignId !== 'string'
    || !uuid.test(ownId) || !uuid.test(foreignId) || ownId.toLowerCase() === foreignId.toLowerCase()
    || typeof cookie !== 'string' || cookie.length === 0) return null;
  return request('/v1/households/current', { headers: { cookie, 'x-household-id': foreignId } });
}
