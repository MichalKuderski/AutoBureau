"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * Privacy & data — export and deletion as product surface, not compliance fine print.
 *
 * This screen is deliberately plain-spoken. It states what we can and cannot see,
 * what deletion actually does, and how long backups persist — because a vague promise
 * from a company holding your passport is worth nothing, and the honesty is the
 * differentiator against an ad-funded incumbent (FOUNDING_PRINCIPLES §11, doc 13 §4).
 */
export function PrivacySettings() {
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What we can and can't see</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              {
                can: true,
                text: "Documents you send us, so we can find dates, amounts, and who they belong to.",
              },
              {
                can: true,
                text: "The registry we build from them — your policies, renewals, and deadlines.",
              },
              {
                can: false,
                text: "Full identity numbers. Passport and account numbers are encrypted; even our own systems that read documents cannot decrypt them.",
              },
              {
                can: false,
                text: "Your email inbox, unless you connect it — and then only to look for documents.",
              },
              {
                can: false,
                text: "Anything sold, shared, or used to train anyone else's models. Ever.",
              },
            ].map((row) => (
              <li key={row.text} className="flex items-start gap-2.5">
                {row.can ? (
                  <Icon.Check className="mt-0.5 size-4 shrink-0 text-ink-tertiary" />
                ) : (
                  <Icon.Shield className="mt-0.5 size-4 shrink-0 text-success" />
                )}
                <span className="text-ink-secondary text-pretty">{row.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export everything</CardTitle>
          <CardDescription>
            Your original documents plus every record we've built from them, in open formats.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                tone: "success",
                title: "Export started",
                description: "We'll email you a download link — usually within a few minutes.",
              })
            }
          >
            <Icon.Upload className="size-4 rotate-180" />
            Request export
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          <CardDescription>
            Everything goes: documents, registry, reminders, and history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert tone="warning" title="What deletion actually does">
            You have 14 days to change your mind. After that we permanently delete your documents
            and every record derived from them. Encrypted backups age out within 35 days — we say
            so plainly rather than pretending a backup can be surgically edited.
          </Alert>
          <div>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete your account?"
        description="We'll stop all reminders immediately and delete everything after 14 days. You can undo this at any point during those 14 days by signing in."
        confirmLabel="Delete my account"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          toast({
            tone: "info",
            title: "Deletion scheduled",
            description: "Sign in within 14 days to undo. We've emailed you the details.",
          });
        }}
      />
    </div>
  );
}
