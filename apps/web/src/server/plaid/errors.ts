export class PlaidError extends Error {
  override name = "PlaidError";
  constructor(readonly code: "unavailable" | "reconnect" | "rate-limited" | "invalid" | "unconfigured") {
    super(`Financial connection: ${code}`);
  }
}
export interface PlaidConfig { clientId: string; secret: string; scope: "stg" | "preview" }
