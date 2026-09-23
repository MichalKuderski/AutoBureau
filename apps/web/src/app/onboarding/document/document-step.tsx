"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { UploadDropzone } from "@/components/ui/upload";
import { StepFooter } from "../onboarding-shell";
import { useOnboarding } from "../onboarding-provider";

/**
 * The activation moment (CJ-1, metric M1).
 *
 * Everything before this is a claim; this is the first piece of evidence, and the
 * first place a real date can come from. So the ask is deliberately small — one
 * document, and we suggest which one, because "upload your documents" is a chore and
 * "photograph the Medicare letter on the counter" is a task.
 *
 * Skipping is a first-class path. A caregiver setting this up on the train doesn't
 * have the paperwork in front of them, and blocking here to protect an activation
 * metric would be the product optimising against its own user.
 */
export function DocumentStep() {
  const router = useRouter();
  const { seed } = useOnboarding();

  const suggestions = seed.obligations.slice(0, 3);

  return (
    <>
      <h1 className="text-2xl leading-tight sm:text-3xl">One document is the fastest start</h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        Sending one isn&apos;t available yet. When it is, we&apos;ll read it, file it under the
        right person, and pull out the dates that matter — that is the step that turns a claim
        into a real date.
      </p>

      {suggestions.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle className="text-lg">The most useful one right now</CardTitle>
              <CardDescription>
                Based on what you ticked, these are the deadlines we can&apos;t date yet.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {suggestions.map((o) => (
                <li key={o.promptId} className="flex items-start gap-2.5 text-sm">
                  <Icon.Documents className="mt-0.5 size-4 shrink-0 text-ink-tertiary" />
                  <span className="min-w-0">
                    <span className="block text-ink">{o.title}</span>
                    <span className="block text-xs text-ink-tertiary">Needs {o.needs}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6">
        {/*
         * Blueprint P0-07, the last surface carrying that defect. `671f0e7` disabled the
         * two `(app)` dropzones and recorded that this one "has the identical defect (same
         * toast, same discarded argument)" but was out of that task's scope. It is the same
         * defect for the same reason: no upload endpoint, no multipart handling and no
         * object-storage client exists anywhere in the workspace, so every file this control
         * accepted was discarded while a success toast said it had been received — during
         * onboarding, which is the worst possible moment to teach someone the product lies.
         * `disabled` is the existing honest placeholder; the enabled path is untouched.
         */}
        <UploadDropzone disabled />
      </div>

      {/*
       * Blueprint P0-10. "Identity numbers are stored encrypted" was present tense for
       * a control that has no implementation anywhere in this repository (ADR-007 is
       * accepted but not built — no code writes to `item_secrets`). Restated as the
       * design commitment it actually is, without implementing anything here.
       */}
      <Alert tone="info" title="What happens to it" className="mt-6">
        We read it for dates, amounts, and who it belongs to. Identity numbers are never
        shown in full, and the plan is to encrypt them before they're ever stored — that
        protection isn't built yet. Delete the document and everything we derived from it
        goes too.
      </Alert>

      <StepFooter note="You can forward documents by email later — that's the channel that keeps working when you're busy.">
        <Button variant="primary" onClick={() => router.push("/onboarding/ready")}>
          Continue
        </Button>
      </StepFooter>
    </>
  );
}
