"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadDropzone } from "@/components/ui/upload";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";

/**
 * Add documents — three ingestion paths, ranked by how much value they'd return for
 * the effort they cost (H1 is the assumption this screen exists to satisfy). The
 * ranking describes the page's intended order, not which paths currently work: only
 * forwarding has a real channel behind it. Upload and the camera capture are disabled
 * below — no storage backend exists yet (blueprint P0-07) — rather than staging a file
 * this screen can only discard.
 */
export function UploadScreen() {
  const { household } = useHousehold();
  const { toast } = useToast();
  // Blueprint P0-08. This used to be synthesised from the household id
  // (`h-${household.id.slice(0, 6)}@in.autobureau.com`) — a plausible-looking address
  // nothing was listening on, told to users forwarding household mail. `emailAlias` is
  // the canonical value the server actually provisions; it is `null` until it does, and
  // there is no substitute for it here.
  const alias = household.emailAlias;

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
            <CardDescription>Not available yet.</CardDescription>
          </CardHeader>
          <CardContent>
            {/*
             * Blueprint P0-07. This control used to stage a file, toast "N documents
             * received," and route to /documents as though the file had gone
             * somewhere — no storage backend exists, so it discarded every file it
             * accepted. `disabled` replaces the file picker with a truthful
             * placeholder rather than pretending the drop succeeded.
             */}
            <UploadDropzone disabled />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Forward it instead</CardTitle>
              <CardDescription>
                {alias
                  ? "The one that keeps working when you're busy — set it once and forget it."
                  : "Not set up for this household yet."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {alias ? (
                <>
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
                    Forward a bill or renewal notice from any inbox. Set up a rule in your mail app
                    and the whole thing runs without you.
                  </p>
                </>
              ) : (
                // No fallback address is synthesised here — see the note above `alias`.
                // The dashed border echoes the disabled dropzone above it, so the page
                // reads as one honest "not yet" rather than two differently-styled ones.
                <div className="rounded-md border border-dashed border-line px-3 py-2.5 text-sm text-ink-tertiary">
                  Forwarding address not available yet.
                </div>
              )}
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
