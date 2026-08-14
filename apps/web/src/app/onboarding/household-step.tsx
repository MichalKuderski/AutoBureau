"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { StepFooter } from "./onboarding-shell";
import { useOnboarding, type CaringFor, type DraftMember } from "./onboarding-provider";

/**
 * Step one: who this is for.
 *
 * The first question is the wedge question. A caregiver answering "my household and
 * a parent's" is telling us the census should be elder-shaped and that items belong
 * to someone who will never log in — which is exactly why members are subjects of the
 * ledger rather than users of the product (PRD F2).
 */

const CHOICES: Array<{ value: CaringFor; title: string; detail: string }> = [
  {
    value: "self",
    title: "Just my own household",
    detail: "Me, and anyone who lives with me.",
  },
  {
    value: "self_and_elder",
    title: "My household, and a parent's",
    detail: "I handle paperwork for someone who doesn't do it themselves.",
  },
];

const MEMBER_KINDS: Array<{ value: DraftMember["kind"]; label: string }> = [
  { value: "adult", label: "Adult" },
  { value: "dependent", label: "Parent or dependent" },
  { value: "child", label: "Child" },
  { value: "pet", label: "Pet" },
  { value: "entity", label: "Estate or trust" },
];

export function HouseholdStep() {
  const router = useRouter();
  const { caringFor, setCaringFor, members, addMember, updateMember, removeMember } =
    useOnboarding();

  const namedCount = members.filter((m) => m.displayName.trim()).length;

  return (
    <>
      <h1 className="text-2xl leading-tight sm:text-3xl">Who are you doing this for?</h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        This shapes what we ask about next. You can change any of it later.
      </p>

      <fieldset className="mt-6">
        <legend className="sr-only">Who you manage paperwork for</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHOICES.map((choice) => {
            const selected = caringFor === choice.value;
            return (
              <label
                key={choice.value}
                className={cn(
                  "flex cursor-pointer flex-col rounded-lg border-2 bg-surface p-4 transition-colors",
                  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                  selected
                    ? "border-accent bg-accent-soft/50"
                    : "border-line hover:border-line-strong",
                )}
              >
                <span className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="caring-for"
                    value={choice.value}
                    checked={selected}
                    onChange={() => setCaringFor(choice.value)}
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{choice.title}</span>
                    <span className="mt-0.5 block text-sm text-ink-secondary text-pretty">
                      {choice.detail}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {caringFor ? (
        <section aria-labelledby="members-heading" className="mt-8">
          <h2 id="members-heading" className="text-xl">
            Who should we track things for?
          </h2>
          <p className="mt-1.5 max-w-xl text-sm text-ink-secondary text-pretty">
            A member is anyone whose paperwork you handle — they don&apos;t need an account, an
            email address, or to know this exists.
          </p>

          <ul className="mt-4 flex flex-col gap-3">
            {members.map((member, index) => (
              <li
                key={member.id}
                className="rounded-lg border border-line bg-surface p-3.5 sm:p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <TextInput
                      label={`Name${members.length > 1 ? ` (person ${index + 1})` : ""}`}
                      value={member.displayName}
                      autoComplete="off"
                      placeholder="Elena Reyes"
                      onChange={(e) => updateMember(member.id, { displayName: e.target.value })}
                    />
                  </div>
                  <div className="sm:w-52">
                    <Select
                      label="Relationship"
                      options={MEMBER_KINDS}
                      value={member.kind}
                      onChange={(e) =>
                        updateMember(member.id, { kind: e.target.value as DraftMember["kind"] })
                      }
                    />
                  </div>
                  <div className="shrink-0 sm:pt-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember(member.id)}
                      aria-label={`Remove ${member.displayName.trim() || `person ${index + 1}`}`}
                    >
                      <Icon.Close className="size-4" />
                      <span className="sm:sr-only">Remove</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            iconLeft={<Icon.Plus className="size-4" />}
            onClick={() => addMember({ displayName: "", kind: "adult" })}
          >
            Add someone
          </Button>
        </section>
      ) : null}

      <StepFooter
        note={
          namedCount === 0
            ? "You can add people later — we'll file everything under your household until you do."
            : undefined
        }
      >
        <Button variant="primary" onClick={() => router.push("/onboarding/census")}>
          Continue
        </Button>
        {caringFor === null ? (
          <span className="text-sm text-ink-tertiary">Pick one to keep going.</span>
        ) : null}
      </StepFooter>
    </>
  );
}
