/** Authoritative local sensitive-operation inventory. This is NOT a hosted
 * activation list. Every entry is gated until application-wide enforcement and
 * provider evidence pass. Matrix changes require corresponding boundary tests. */
const owner = { principal: "signed-session", membership: "current-owner", account: "active",
  providerFactors: "fresh-at-most-60s", recentAuth: "password-or-aal2-totp-15m",
  transaction: "owner-policy-fence-and-db-clock", instantSessionRevocation: false } as const;
export const SENSITIVE_OPERATION_MATRIX = {
  "household.delete": { ...owner, mode: "recent", fence: "open", implementation: "local-domain" },
  "household.undo-delete": { ...owner, mode: "recent", fence: "undo-window-only", implementation: "local-domain" },
  "household.irreversible-delete": { principal: "reviewed-retention-worker", mode: "worker", fence: "mature-fenced",
    implementation: "final-receipt-disabled", transaction: "lease-and-independent-evidence", instantSessionRevocation: false },
  "export.generate": { ...owner, mode: "recent", fence: "open", implementation: "partial-local-artifact" },
  "export.revoke": { ...owner, mode: "recent", fence: "open", implementation: "partial-local-artifact" },
  "export.download": { ...owner, mode: "recent", fence: "open", implementation: "partial-local-artifact" },
  "security.list": { ...owner, mode: "bootstrap", recentAuth: "signed-current-session", fence: "open", implementation: "local-controller" },
  "security.enroll": { ...owner, mode: "bootstrap", fence: "open", implementation: "local-controller" },
  "security.challenge": { ...owner, mode: "bootstrap", recentAuth: "aal1-step-up-or-recent-enrollment", fence: "open", implementation: "local-controller" },
  "security.verify": { ...owner, mode: "bootstrap", recentAuth: "one-use-challenge-same-session", fence: "open", implementation: "local-controller" },
  "security.remove-factor": { ...owner, mode: "recent", fence: "open-no-required-verified-factor-removal", implementation: "local-controller" },
  "recovery.initiate": { mode: "public-recovery", principal: "none", membership: "none", implementation: "local-controller",
    transaction: "shared-rate-limit-only", instantSessionRevocation: false },
  "recovery.complete": { ...owner, mode: "recovery", recentAuth: "fresh-one-use-redemption-and-existing-factor", fence: "open", implementation: "local-controller" },
  "billing.manage": { ...owner, mode: "recent", fence: "open", implementation: "not-mounted" },
  "billing.checkout": { ...owner, mode: "recent", fence: "open", implementation: "not-mounted" },
  "billing.portal": { ...owner, mode: "recent", fence: "open", implementation: "not-mounted" },
  "financial.link": { ...owner, mode: "recent", fence: "open", implementation: "not-mounted" },
  "financial.unlink": { ...owner, mode: "recent", fence: "open", implementation: "local-domain" },
  "identifier.reveal": { ...owner, mode: "recent", fence: "open", implementation: "separate-reveal-review-required" },
  "document.download": { ...owner, mode: "recent", fence: "open", implementation: "separate-original-access-review-required" },
} as const;
export type SensitiveOperationName = keyof typeof SENSITIVE_OPERATION_MATRIX;
export type RecentOperation = { [K in SensitiveOperationName]: typeof SENSITIVE_OPERATION_MATRIX[K]["mode"] extends "recent" ? K : never }[SensitiveOperationName];
export const recentOperations = Object.keys(SENSITIVE_OPERATION_MATRIX).filter(
  k => SENSITIVE_OPERATION_MATRIX[k as SensitiveOperationName].mode === "recent") as RecentOperation[];

/** Exact local HTTP seams. No Next route or environment flag activates them. */
export const LOCAL_ACCOUNT_ROUTES = {
  "/v1/account/security": "security",
  "/v1/auth/recovery": "initiate",
  "/v1/auth/recovery/complete": "complete",
} as const;

/** Every currently mounted route/method is classified. The native AST guard fails
 * on additions, re-exports, nonliteral capabilities, or removed request wrappers.
 * Registry document GET is metadata only; original/reveal access remains gated.
 * Ordinary endpoints use live session/factor checks in the shared request boundary.
 * Hosted readiness still requires provider/session and exact-candidate evidence. */
export const MOUNTED_ROUTE_MATRIX: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "v1/account/security": { POST: "local-account" },
  "v1/auth/recovery": { POST: "local-account" },
  "v1/auth/recovery/complete": { POST: "local-account" },
  "auth/callback": { GET: "auth-special" },
  "auth/confirm": { GET: "auth-special" },
  "auth/refresh": { GET: "auth-special" },
  "v1/auth/sign-in": { POST: "auth-special" },
  "v1/auth/sign-up": { POST: "auth-special" },
  "v1/auth/magic-link": { POST: "auth-special" },
  "v1/auth/sign-out": { POST: "auth-special" },
  "v1/dashboard": { GET: "registry.read" },
  "v1/documents/quota": { GET: "registry.read" },
  "v1/documents": { GET: "registry.read" },
  "v1/documents/[id]": { GET: "registry.read" },
  "v1/documents/uploads": { POST: "document.upload" },
  "v1/documents/[id]/complete": { POST: "document.upload" },
  "v1/documents/[id]/work": { GET: "registry.read" },
  "v1/documents/[id]/cancel": { POST: "document.upload" },
  "v1/documents/[id]/result": { GET: "document.resolve" },
  "v1/documents/[id]/result/apply": { POST: "document.resolve" },
  "v1/documents/[id]/result/discard": { POST: "document.resolve" },
  "v1/items": { GET: "registry.read", POST: "item.write" },
  "v1/items/[id]": { GET: "registry.read", PATCH: "item.write" },
  "v1/obligations": { GET: "registry.read", POST: "obligation.write" },
  "v1/obligations/[id]": { GET: "registry.read", PATCH: "obligation.write" },
  "v1/timeline": { GET: "registry.read" },
  "v1/notifications": { GET: "registry.read" },
  "v1/notifications/read": { POST: "registry.read" },
  "v1/me": { GET: "member-session", PATCH: "member-session" },
  "v1/me/notification-settings": { GET: "registry.read", PATCH: "settings.manage" },
  "v1/onboarding": { GET: "settings.manage", PATCH: "settings.manage" },
  "v1/households/current": { GET: "registry.read" },
  "v1/households/[id]": { PATCH: "settings.manage" },
  "v1/households/[id]/deletion": { GET: "settings.manage", POST: "household.delete" },
  "v1/households/[id]/deletion/undo": { POST: "household.delete" },
  "v1/households/[id]/exports": { GET: "settings.manage", POST: "household.export" },
  "v1/households/[id]/exports/revoke": { POST: "household.export" },
  "v1/households/[id]/exports/[requestId]": { GET: "household.export" },
  "v1/households/[id]/financial-connections": { GET: "financial.read" },
  "v1/households/[id]/financial-connections/[itemId]/unlink": { POST: "financial.manage" },
  "v1/households/[id]/financial-connections/[itemId]/reconnect": { POST: "financial.manage" },
  "v1/households/[id]/members": { GET: "registry.read", POST: "member.manage" },
  "v1/households/[id]/members/[mid]": { PATCH: "member.manage", DELETE: "member.manage" },
  "v1/households/[id]/members/[mid]/restore": { POST: "member.manage" },
};

/** Security classification is derived from the reviewed capability, never URL text
 * or a client flag. Public auth and local bootstrap flows own separate contracts. */
export const MOUNTED_ROUTE_POLICY = Object.fromEntries(Object.entries(MOUNTED_ROUTE_MATRIX).map(([path,methods])=>[
  path,Object.fromEntries(Object.entries(methods).map(([method,capability])=>{
    const bootstrap=capability==="local-account", publicAuth=capability==="auth-special";
    return [method,{
      capability, public:publicAuth || path.startsWith("v1/auth/recovery"),
      authenticated:!publicAuth && !path.startsWith("v1/auth/recovery"),
      householdScoped:!publicAuth && !bootstrap,
      ownerOnly:bootstrap ? !path.endsWith("auth/recovery") : ["member.manage","settings.manage","household.delete","household.export","financial.read","financial.manage","document.resolve"].includes(capability),
      recentAuth:["secret.reveal","household.delete","household.export","financial.manage"].includes(capability),
      mfa:publicAuth?"session-establishment":bootstrap?"explicit-step-up-recovery-contract":"live-factors-and-household-policy",
      deletionFence:!publicAuth,
      financial:capability.startsWith("financial."), privacyExportDelete:["household.delete","household.export"].includes(capability),
      runtime:bootstrap?"synthetic-loopback-only":"standard",
    }];
  })),
]));
