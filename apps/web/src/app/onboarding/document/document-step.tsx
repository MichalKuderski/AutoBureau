"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { UploadDropzone } from "@/components/ui/upload";
import { useToast } from "@/components/ui/toast";
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
  const { toast } = useToast();
  const { seed, recordDocuments, documentsAdded } = useOnboarding();

  const suggestions = seed.obligations.slice(0, 3);

  return (
    <>
      <h1 className="text-2xl leading-tight sm:text-3xl">Send us one document</h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        One is enough to start. We&apos;ll read it, file it under the right person, and pull out
        the dates that matter.
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
                    <span className="block text-xs text-ink-tertiary">Send {o.needs}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6">
        <UploadDropzone
          onFiles={(files) => {
            recordDocuments(files.length);
            toast({
              tone: "success",
              title: `${files.length} ${files.length === 1 ? "document" : "documents"} received`,
              description: "We'll start reading it now — this usually takes under a minute.",
            });
            router.push("/onboarding/ready");
          }}
        />
      </div>

      <Alert tone="info" title="What happens to it" className="mt-6">
        We read it for dates, amounts, and who it belongs to. Identity numbers are stored encrypted
        and never shown in full. Delete the document and everything we derived from it goes too.
      </Alert>

      <StepFooter note="You can forward documents by email later — that's the channel that keeps working when you're busy.">
        <Button variant="primary" onClick={() => router.push("/onboarding/ready")}>
          {documentsAdded > 0 ? "Continue" : "I'll do this later"}
        </Button>
      </StepFooter>
    </>
  );
}
