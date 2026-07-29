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

/** Cursor-paginated envelope — every list endpoint returns this (doc 03 §1). */
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface Provenance {
  document_id: string;
  document_title: string;
  /** Where in the source document the fact came from, when known. */
  excerpt?: string;
  captured_at: string;
}

export interface ObligationView extends Obligation {
  member_name: string | null;
  item_name: string | null;
  provenance: Provenance | null;
  /** Derived server-side so every client agrees on urgency. */
  days_until: number;
}

export interface ItemView extends Item {
  member_name: string | null;
  open_obligation_count: number;
  document_count: number;
  /** Masked identifiers; full values never leave the server (ADR-007). */
  secrets: Array<{ field: string; last4: string | null }>;
}

export interface DocumentView extends DocumentMeta {
  member_name: string | null;
  linked_item_ids: string[];
  /** Populated only when status is `needs_review`. */
  proposed_changes: ProposedChange[] | null;
}

export interface ProposedChange {
  kind: "item" | "obligation";
  action: "create" | "update";
  label: string;
  fields: Array<{ path: string; value: string; confidence: number }>;
}

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

export interface DashboardSummary {
  action_needed: number;
  upcoming_30d: number;
  needs_review: number;
  items_tracked: number;
  value_found_cents: number;
  /** Everything the household would otherwise be tracking from memory. */
  coverage: { captured: number; expected: number };
  next_digest_at: string;
}
