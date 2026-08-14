import type { Item, Obligation } from "./types";

/**
 * The guided census (PRD F3, CJ-1).
 *
 * This is the answer to the takeover problem: someone has just become responsible
 * for a parent's affairs and cannot list what exists, because nobody ever wrote it
 * down. A checklist beats a blank form here — recognition is cheap, recall is not,
 * and "does Mom have a supplemental policy?" is answerable in a second while "list
 * her insurance" is not answerable at all.
 *
 * Two rules shape the content. It is caregiver-shaped, which is why elder benefits
 * lead and career paperwork is absent (PRD §4). And it is **wedge-dependent** — the
 * pre-G1 backlog classifies census content as G-3, changeable by gate evidence — so
 * it lives here as data, in one file, editable without touching a screen.
 *
 * The hard constraint: a census answer is a *claim*, not a citation. It seeds an
 * item flagged unverified and, where a deadline is implied, an obligation with **no
 * date** — because uncited dates never become obligations (FOUNDING_PRINCIPLES §7).
 * The date arrives with the document, or it doesn't arrive at all.
 */

export interface CensusPrompt {
  id: string;
  /** Phrased as a question a person can answer without looking anything up. */
  label: string;
  hint?: string;
  itemKind: Item["kind"];
  /** The provisional item's name in the registry until a document renames it. */
  itemName: string;
  /**
   * Present when saying yes implies a deadline exists. The obligation is seeded
   * dateless and stays that way until a document proves the date.
   */
  obligation?: { kind: Obligation["kind"]; title: string; needs: string };
}

export interface CensusGroup {
  id: string;
  title: string;
  description: string;
  prompts: CensusPrompt[];
}

export const CENSUS: CensusGroup[] = [
  {
    id: "health",
    title: "Health and benefits",
    description: "The paperwork with the least forgiving deadlines.",
    prompts: [
      {
        id: "medicare",
        label: "Medicare",
        hint: "Part A, Part B, or a Medicare Advantage plan",
        itemKind: "benefit_plan",
        itemName: "Medicare",
        obligation: {
          kind: "enrollment",
          title: "Medicare enrollment window",
          needs: "the enrollment or annual notice",
        },
      },
      {
        id: "supplemental",
        label: "A supplemental or Medigap policy",
        itemKind: "insurance_policy",
        itemName: "Supplemental health policy",
        obligation: {
          kind: "payment",
          title: "Supplemental premium",
          needs: "a premium statement",
        },
      },
      {
        id: "part_d",
        label: "Prescription drug coverage",
        hint: "Part D, or drug coverage inside an Advantage plan",
        itemKind: "benefit_plan",
        itemName: "Prescription coverage",
      },
      {
        id: "medical_accounts",
        label: "Bills from a hospital or specialist",
        hint: "Explanation-of-benefits letters count",
        itemKind: "medical_account",
        itemName: "Medical billing",
      },
    ],
  },
  {
    id: "home",
    title: "Home",
    description: "Where they live, and what it costs to keep it running.",
    prompts: [
      {
        id: "lease",
        label: "A lease or a mortgage",
        itemKind: "lease",
        itemName: "Home — lease or mortgage",
        obligation: {
          kind: "renewal",
          title: "Lease renewal or notice period",
          needs: "the lease or mortgage statement",
        },
      },
      {
        id: "home_insurance",
        label: "Home or renters insurance",
        itemKind: "insurance_policy",
        itemName: "Home insurance",
        obligation: {
          kind: "renewal",
          title: "Home insurance renewal",
          needs: "the policy or renewal notice",
        },
      },
      {
        id: "utilities",
        label: "Utility accounts in their name",
        hint: "Power, water, gas, internet",
        itemKind: "utility_account",
        itemName: "Utility accounts",
      },
    ],
  },
  {
    id: "vehicle",
    title: "Getting around",
    description: "Registrations lapse quietly and cost the most to fix.",
    prompts: [
      {
        id: "vehicle",
        label: "A car or other vehicle",
        itemKind: "vehicle",
        itemName: "Vehicle",
        obligation: {
          kind: "renewal",
          title: "Vehicle registration renewal",
          needs: "the registration card or renewal notice",
        },
      },
      {
        id: "auto_insurance",
        label: "Car insurance",
        itemKind: "insurance_policy",
        itemName: "Auto policy",
        obligation: {
          kind: "renewal",
          title: "Auto policy renewal",
          needs: "the policy declaration page",
        },
      },
    ],
  },
  {
    id: "identity",
    title: "Identity documents",
    description: "Slow to replace, and always needed at the worst moment.",
    prompts: [
      {
        id: "passport",
        label: "A passport",
        itemKind: "passport",
        itemName: "Passport",
        obligation: {
          kind: "renewal",
          title: "Passport renewal",
          needs: "a photo of the photo page",
        },
      },
      {
        id: "license",
        label: "A driver's licence or state ID",
        itemKind: "drivers_license",
        itemName: "Driver's licence or state ID",
        obligation: {
          kind: "renewal",
          title: "Licence renewal",
          needs: "a photo of the card",
        },
      },
    ],
  },
  {
    id: "recurring",
    title: "Money going out, and money owed back",
    description: "The quiet category — this is usually where we find money.",
    prompts: [
      {
        id: "subscriptions",
        label: "Subscriptions or memberships",
        hint: "Streaming, gym, alarm monitoring, magazines",
        itemKind: "subscription",
        itemName: "Subscriptions",
      },
      {
        id: "warranties",
        label: "Warranties on anything expensive",
        hint: "Appliances, HVAC, a roof, a car",
        itemKind: "warranty",
        itemName: "Warranties",
      },
    ],
  },
];

export const CENSUS_PROMPT_COUNT = CENSUS.reduce((n, g) => n + g.prompts.length, 0);

export interface ProvisionalItem {
  promptId: string;
  name: string;
  kind: Item["kind"];
  /** Every item belongs to exactly one member (PRD F2). Null means the household. */
  memberId: string | null;
  memberName: string | null;
}

export interface ProvisionalObligation {
  promptId: string;
  title: string;
  kind: Obligation["kind"];
  /** What we need before this can carry a real date. */
  needs: string;
  memberName: string | null;
}

export interface CensusSeed {
  items: ProvisionalItem[];
  obligations: ProvisionalObligation[];
}

/**
 * Turns census answers into the provisional ledger.
 *
 * Pure and total: same answers in, same seed out, no clock and no randomness, so the
 * summary a user sees at the end of onboarding is the same one the server will build
 * from the same answers.
 */
export function seedFromCensus(
  selectedPromptIds: Iterable<string>,
  subject: { id: string; name: string } | null,
): CensusSeed {
  const selected = new Set(selectedPromptIds);
  const items: ProvisionalItem[] = [];
  const obligations: ProvisionalObligation[] = [];

  for (const group of CENSUS) {
    for (const prompt of group.prompts) {
      if (!selected.has(prompt.id)) continue;
      items.push({
        promptId: prompt.id,
        name: prompt.itemName,
        kind: prompt.itemKind,
        memberId: subject?.id ?? null,
        memberName: subject?.name ?? null,
      });
      if (prompt.obligation) {
        obligations.push({
          promptId: prompt.id,
          title: prompt.obligation.title,
          kind: prompt.obligation.kind,
          needs: prompt.obligation.needs,
          memberName: subject?.name ?? null,
        });
      }
    }
  }

  return { items, obligations };
}
