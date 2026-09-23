/** Fixed projections only: an upstream response is not safe diagnostic output. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function configuredSignInRefusal(response, body) {
  return response.status === 401
    && response.headers.get('content-type')?.split(';')[0].trim() === 'application/problem+json'
    && body?.status === 401
    && body?.type === 'https://autobureau.com/problems/unauthorized';
}
export function authSmokeEvidence(response, body, startedAt, durationMs) {
  const requestId = response.headers.get('x-request-id');
  const retryAfter = response.headers.get('retry-after');
  const reason = response.status === 503
    ? (body?.detail === 'Authentication is not configured on this deployment.' ? 'configuration-unavailable'
      : body?.detail === 'Sign-in is briefly unavailable.' ? 'temporary-auth-unavailable' : 'unclassified-unavailable')
    : response.status === 401 ? 'credential-refusal' : 'unexpected-auth-response';
  return { status: response.status, startedAt, durationMs: Math.round(durationMs), reason,
    ...(uuid.test(requestId ?? '') ? { requestId } : {}),
    ...(typeof retryAfter === 'string' && /^\d{1,5}$/.test(retryAfter) ? { retryAfterSeconds: Number(retryAfter) } : {}) };
}
