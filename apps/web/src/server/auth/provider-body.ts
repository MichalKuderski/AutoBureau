// Compatibility entry point for the auth boundary; Plaid shares the bounded reader.
export {
  discardProviderBody, MAX_PROVIDER_RESPONSE_BYTES, MAX_PROVIDER_RESPONSE_CHUNKS,
  ProviderBodyError, readProviderJson, type ProviderBodyFailure,
} from "../http/provider-body";
