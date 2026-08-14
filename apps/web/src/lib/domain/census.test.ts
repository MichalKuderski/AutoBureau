import { describe, expect, it } from "vitest";
import { CENSUS, CENSUS_PROMPT_COUNT, seedFromCensus } from "./census";
import { ItemKindSchema, ObligationKindSchema } from "@autobureau/contracts";

/**
 * The census is product content, so most of it is a copy decision rather than a
 * testable one. Two things are not: the enums it emits have to be real (a typo here
 * produces an item the API will reject at the first write), and a census answer must
 * never manufacture a date — uncited dates cannot become obligations
 * (FOUNDING_PRINCIPLES §7).
 */

describe("census catalogue", () => {
  it("emits only kinds the contracts recognise", () => {
    for (const group of CENSUS) {
      for (const prompt of group.prompts) {
        expect(ItemKindSchema.safeParse(prompt.itemKind).success).toBe(true);
        if (prompt.obligation) {
          expect(ObligationKindSchema.safeParse(prompt.obligation.kind).success).toBe(true);
        }
      }
    }
  });

  it("uses each prompt id exactly once", () => {
    const ids = CENSUS.flatMap((g) => g.prompts.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(CENSUS_PROMPT_COUNT);
  });

  it("stays short enough to finish in one sitting", () => {
    // PRD F3: completable in about seven minutes. A checklist that grows past this
    // stops being recognition and starts being a form.
    expect(CENSUS_PROMPT_COUNT).toBeLessThanOrEqual(16);
  });
});

describe("seedFromCensus", () => {
  const subject = { id: "m-2", name: "Elena Reyes" };

  it("creates one provisional item per answer, attributed to the member", () => {
    const seed = seedFromCensus(["medicare", "passport"], subject);
    expect(seed.items).toHaveLength(2);
    expect(seed.items.every((i) => i.memberId === "m-2")).toBe(true);
  });

  it("seeds a dateless obligation when an answer implies a deadline", () => {
    const seed = seedFromCensus(["medicare"], subject);
    expect(seed.obligations).toHaveLength(1);
    const [obligation] = seed.obligations;
    expect(obligation).toMatchObject({ kind: "enrollment", memberName: "Elena Reyes" });
    // The shape carries no date at all — there is nowhere for a guess to live.
    expect(obligation).not.toHaveProperty("due_at");
    expect(obligation!.needs).toBeTruthy();
  });

  it("seeds no obligation for answers that only establish an item", () => {
    const seed = seedFromCensus(["utilities", "subscriptions"], subject);
    expect(seed.items).toHaveLength(2);
    expect(seed.obligations).toHaveLength(0);
  });

  it("attributes to the household when there is no subject", () => {
    const seed = seedFromCensus(["lease"], null);
    expect(seed.items[0]).toMatchObject({ memberId: null, memberName: null });
  });

  it("ignores answers it doesn't recognise instead of inventing rows", () => {
    expect(seedFromCensus(["not-a-prompt"], subject)).toEqual({ items: [], obligations: [] });
    expect(seedFromCensus([], subject)).toEqual({ items: [], obligations: [] });
  });

  it("is order-independent and deduplicating", () => {
    const once = seedFromCensus(["medicare", "passport"], subject);
    const twice = seedFromCensus(["passport", "medicare", "medicare"], subject);
    expect(twice.items.map((i) => i.promptId).sort()).toEqual(
      once.items.map((i) => i.promptId).sort(),
    );
  });
});
