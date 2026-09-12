import type {
  DocumentMeta,
  Household,
  HouseholdMember,
  Item,
  Obligation,
} from "@autobureau/contracts";

/**
 * View models.
 *
 * The wire shapes come from `@autobureau/contracts` and are authoritative. These
 * types add only what a *screen* needs and the API genuinely returns alongside —
 * resolved member names, provenance links, computed urgency. Keeping them separate
 * means a UI convenience can never silently redefine a domain shape.
 */

export type { DocumentMeta, Household, HouseholdMember, Item, Obligation };

/**
 * Cursor-paginated envelope — every list endpoint returns this (doc 03 §1, ADR-011).
 *
 * Re-exported rather than redeclared. It is a *wire* shape, so it belongs in
 * `packages/contracts`, which doc 03 names as the source of truth; a second definition
 * here was one edit away from disagreeing with the schema the server validates against.
 */
export type { Page } from "@autobureau/contracts";

export type { Provenance, ObligationView, ItemView, DocumentView, ProposedChange, DashboardSummary } from "@autobureau/contracts";

export interface TimelineEntry {
  id: string;
  at: string;
  kind:
    | "document_added"
    | "obligation_created"
    | "obligation_completed"
    | "item_added"
    | "item_expiring"
    | "reminder_sent"
    | "value_found";
  title: string;
  detail?: string;
  member_name?: string | null;
  href?: string;
  amount_cents?: number | null;
}

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  href: string | null;
}
