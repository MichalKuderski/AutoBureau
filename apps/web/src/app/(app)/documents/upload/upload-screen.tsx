"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadDropzone } from "@/components/ui/upload";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";

/**
 * Add documents — the three ingestion paths, ranked by how much value they return
 * for the effort they cost (H1 is the assumption this screen exists to satisfy).
 *
 * Forwarding is presented first and most prominently because it is the only channel
 * that keeps working without the user ever visiting the app again; upload is the
 * fallback, and the camera is the phone-in-a-waiting-room case.
 */
export function UploadScreen() {
  const router = useRouter();
  const { household } = useHousehold();
  const { toast } = useToast();
  const alias = `h-${household.id.slice(0, 6)}@in.autobureau.com`;

  return (
    <>
      <PageHeader
        title="Add documents"
        description="However it reaches us, we'll read it, file it, and watch the dates."
      />

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Upload or photograph</CardTitle>
            <CardDescription>
              PDFs, photos, or a forwarded email saved to your device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadDropzone
              onFiles={(files) => {
                toast({
                  tone: "success",
                  title: `${files.length} ${files.length === 1 ? "document" : "documents"} received`,
                  description: "We'll let you know if anything needs a second look.",
                });
                router.push("/documents");
              }}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Forward it instead</CardTitle>
              <CardDescription>
                The one that keeps working when you're busy — set it once and forget it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{alias}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(alias);
                    toast({ tone: "success", title: "Copied", description: "Address copied." });
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-sm text-ink-secondary text-pretty">
                Forward a bill or renewal notice from any inbox. Set up a rule in your mail app and
                the whole thing runs without you.
              </p>
            </CardContent>
          </Card>

          <Alert tone="info" title="What we do with what you send">
            We read it to find dates, amounts, and who it belongs to. Identity numbers are stored
            encrypted and never shown in full. You can delete any document — and everything derived
            from it — at any time.
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>What's most useful</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm text-ink-secondary">
                {[
                  "Insurance policies and renewal notices",
                  "Vehicle registration and licence renewals",
                  "Medicare, benefits, and enrolment letters",
                  "Leases, deposits, and utility accounts",
                  "Warranties and receipts for anything expensive",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Icon.Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    {line}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
