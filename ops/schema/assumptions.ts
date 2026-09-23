import { z } from "zod";

/**
 * Schema for ops/assumptions.yaml — the machine-readable assumption registry.
 *
 * This is not ceremony. The registry is edited under time pressure during customer
 * validation, by whoever is closest to the evidence. Without a schema it silently
 * degrades into prose, and the dashboard that renders from it starts lying.
 *
 * Field vocabulary is deliberately closed: an open enum is an invitation to invent
 * a sixteenth confidence level at 11pm.
 */

export const CategorySchema = z.enum(["existential", "strategic", "product", "operational"]);
export const CostSchema = z.enum(["low", "medium", "high", "existential"]);
export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export const TrendSchema = z.enum(["up", "down", "flat"]);
export const StatusSchema = z.enum([
  "untested",
  "testing",
  "supported",
  "weakened",
  "refuted",
  "retired",
]);

/** Strongest first — mirrors FOUNDING_PRINCIPLES §10. */
export const EvidenceClassSchema = z.enum([
  "behavioral",
  "paid",
  "stated",
  "expert",
  "secondary",
  "prior",
]);

export const DirectionSchema = z.enum(["supports", "weakens", "neutral"]);

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const EvidenceEntrySchema = z.object({
  date: IsoDate,
  source: z.string().min(3),
  evidence_class: EvidenceClassSchema,
  /** Sample size. Explicitly null when not applicable (e.g. desk research). */
  n: z.number().int().positive().nullable(),
  direction: DirectionSchema,
  note: z.string().min(3),
});

export const AssumptionSchema = z.object({
  id: z.string().regex(/^H\d+$/),
  description: z.string().min(20),
  category: CategorySchema,
  cost_if_wrong: CostSchema,
  confidence: ConfidenceSchema,
  confidence_trend: TrendSchema,
  status: StatusSchema,
  owner: z.enum(["founder", "cto", "ops"]),
  accountable: z.enum(["founder", "cto", "ops"]).optional(),
  validation_experiment: z.string().min(10),
  kill_threshold: z.string().min(5).nullable(),
  next_evidence_due: IsoDate.nullable(),
  validates_at: z.string().min(2),
  reconfirms_at: z.string().min(2).optional(),
  related_prd: z.array(z.string()),
  related_adr: z.array(z.string().regex(/^ADR-\d{3}$/)),
  related_docs: z.array(z.string()),
  evidence: z.array(EvidenceEntrySchema),
});

export const RegistrySchema = z.object({
  version: z.number().int().positive(),
  updated: IsoDate,
  next_gate: z.object({
    id: z.string(),
    expected: IsoDate,
    decides: z.string().min(10),
  }),
  owners: z.record(z.string(), z.object({ key: z.string(), role: z.string() })),
  assumptions: z.array(AssumptionSchema).min(1),
});

export type Assumption = z.infer<typeof AssumptionSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;
