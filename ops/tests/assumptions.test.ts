import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { RegistrySchema, type Registry } from "../schema/assumptions.js";

/**
 * Registry integrity. These tests exist because the assumption ledger is a governing
 * document that gets edited fastest exactly when the company is under the most
 * pressure — during customer validation. Structural rot there is invisible until the
 * dashboard misleads a decision.
 */

const registryPath = fileURLToPath(new URL("../assumptions.yaml", import.meta.url));
const raw = readFileSync(registryPath, "utf8");
const parsed: unknown = parse(raw);

describe("assumptions.yaml", () => {
  it("parses and conforms to the registry schema", () => {
    const result = RegistrySchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `registry schema violations:\n${result.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`,
      );
    }
    expect(result.success).toBe(true);
  });
});

describe("registry invariants", () => {
  const registry = RegistrySchema.parse(parsed) as Registry;

  it("has unique ids", () => {
    const ids = registry.assumptions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every existential assumption a kill threshold", () => {
    // An existential bet with no pre-agreed falsification is how goalposts move.
    const offenders = registry.assumptions
      .filter((a) => a.cost_if_wrong === "existential" && !a.kill_threshold)
      .map((a) => a.id);
    expect(offenders).toEqual([]);
  });

  it("gives every untested or testing assumption a next-evidence date", () => {
    const offenders = registry.assumptions
      .filter((a) => (a.status === "untested" || a.status === "testing") && !a.next_evidence_due)
      .map((a) => a.id);
    expect(offenders).toEqual([]);
  });

  it("does not claim high confidence without at least one piece of evidence", () => {
    const offenders = registry.assumptions
      .filter((a) => a.confidence === "high" && a.evidence.length === 0)
      .map((a) => a.id);
    expect(offenders).toEqual([]);
  });

  it("does not claim supported status on prior-only evidence", () => {
    // "We reasoned about it" is not support. This guard is the anti-self-delusion rule.
    const offenders = registry.assumptions
      .filter(
        (a) =>
          a.status === "supported" &&
          a.evidence.every((e) => e.evidence_class === "prior" || e.direction !== "supports"),
      )
      .map((a) => a.id);
    expect(offenders).toEqual([]);
  });

  it("keeps every referenced owner defined in the owners block", () => {
    const known = Object.keys(registry.owners);
    for (const a of registry.assumptions) {
      expect(known).toContain(a.owner);
      if (a.accountable) expect(known).toContain(a.accountable);
    }
  });

  it("retains the existential pair that gates the company", () => {
    const existential = registry.assumptions
      .filter((a) => a.category === "existential")
      .map((a) => a.id)
      .sort();
    // Ingestion behavior and willingness to pay. If either is ever quietly downgraded,
    // this test should be the thing that argues back.
    expect(existential).toEqual(["H1", "H2"]);
  });
});
