"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { parseCents } from "@/lib/format";
import type { ObligationView } from "@/lib/domain/types";
import type { ObligationOutcome } from "@autobureau/contracts";

/**
 * Outcome capture (PRD F9, A-F3).
 *
 * When someone marks an obligation done, what actually happened in the world is the
 * single most valuable thing this product can learn — it is the feed for the second
 * ledger (what a renewal really costs, whether the process matched what we said).
 *
 * Two rules keep it honest. It is *skippable*, prominently, because a mandatory form
 * between a user and "done" trains people to lie to it. And it only asks what we can
 * act on: two fields, both optional, no free-text field nobody will read.
 */

const HANDLED_BY: Array<{ value: ObligationOutcome["done_via"]; label: string }> = [
  { value: "manual", label: "I handled it myself" },
  { value: "external", label: "Someone else handled it" },
  { value: "auto", label: "It happened automatically" },
];

export function OutcomeDialog({
  open,
  obligation,
  onClose,
  onSubmit,
}: {
  open: boolean;
  obligation: ObligationView;
  onClose: () => void;
  /** `undefined` means the user skipped — done, but nothing learned. */
  onSubmit: (outcome: ObligationOutcome | undefined) => void;
}) {
  const [doneVia, setDoneVia] = useState<ObligationOutcome["done_via"]>("manual");
  const [cost, setCost] = useState("");
  const [costError, setCostError] = useState<string | undefined>(undefined);

  const reset = () => {
    setDoneVia("manual");
    setCost("");
    setCostError(undefined);
  };

  const close = () => {
    reset();
    onClose();
  };

  const save = () => {
    const trimmed = cost.trim();
    let costCents: number | null = null;
    if (trimmed) {
      const parsed = parseCents(trimmed);
      if (parsed === null) {
        setCostError("Enter an amount like 168 or 168.50, or leave it blank.");
        return;
      }
      costCents = parsed;
    }
    reset();
    onSubmit({ done_via: doneVia, cost_cents: costCents });
  };

  const skip = () => {
    reset();
    onSubmit(undefined);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title="Marking it done — how did it go?"
      description="Two optional questions. What you tell us here makes the next reminder better."
      footer={
        <>
          <Button variant="ghost" onClick={skip}>
            Skip
          </Button>
          <Button variant="primary" onClick={save} data-autofocus>
            Save and close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Who handled it"
          options={HANDLED_BY}
          value={doneVia}
          onChange={(e) => setDoneVia(e.target.value as ObligationOutcome["done_via"])}
        />
        <TextInput
          label="What did it cost?"
          inputMode="decimal"
          placeholder={obligation.currency === "USD" || !obligation.currency ? "0.00" : ""}
          description="Optional. Leave blank if it was free, or if you'd rather not say."
          value={cost}
          error={costError}
          onChange={(e) => {
            setCost(e.target.value);
            if (costError) setCostError(undefined);
          }}
        />
      </div>
    </Modal>
  );
}
