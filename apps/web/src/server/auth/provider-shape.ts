/** The provider boundary is not a domain API. Project only the three session fields
 * and the minimal pending-user discriminator; never carry provider metadata forward.
 * Kept dependency-free so the exact transport/decoder can be exercised with real HTTP
 * without initializing the application's database, framework or provider SDK.
 */
export interface ParsedProviderTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_FIELDS = ["access_token", "refresh_token", "expires_in"] as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseProviderTokens(value: unknown): ParsedProviderTokens | null {
  if (!record(value)) return null;
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = value;
  if (typeof accessToken !== "string" || accessToken.length === 0
    || typeof refreshToken !== "string" || refreshToken.length === 0
    || typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, refreshToken, expiresIn };
}

export function isPendingProviderUser(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && UUID.test(value.id)
    && !TOKEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}
