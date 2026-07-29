"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextInput, Toggle } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";

/**
 * Your profile — identity, security, and session.
 *
 * Multi-factor is offered rather than demanded until the household holds identifier-
 * grade values, at which point the data itself justifies the friction (doc 06 §1).
 * The copy says why, because a security prompt without a reason reads as nagging.
 */
export function ProfileSettings() {
  const { viewer } = useHousehold();
  const { toast } = useToast();
  const [name, setName] = useState(viewer.displayName);
  const [mfa, setMfa] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>How you appear in your household.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextInput
            label="Email"
            type="email"
            value={viewer.email}
            readOnly
            description="Used for reminders and sign-in. Contact support to change it."
          />
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast({ tone: "success", title: "Saved", description: "Profile updated." })
              }
            >
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Your household holds identity documents. These settings protect them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Toggle
            label="Two-step verification"
            description="Ask for a code from your authenticator app when signing in on a new device."
            checked={mfa}
            onChange={(next) => {
              setMfa(next);
              toast({
                tone: next ? "success" : "info",
                title: next ? "Two-step verification on" : "Two-step verification off",
                description: next
                  ? "You'll be asked for a code on new devices."
                  : "You can turn this back on at any time.",
              });
            }}
          />
          <div className="border-t border-line pt-4">
            <Button variant="secondary" size="sm">
              Change password
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
            <Icon.Shield className="size-4 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <span className="block text-sm text-ink">This device</span>
              <span className="block text-xs text-ink-tertiary">Active now</span>
            </div>
          </div>
          <div>
            <Button variant="ghost" size="sm">
              Sign out everywhere else
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert tone="info" title="Your data belongs to you">
        You can export everything or delete your account at any time, from Privacy &amp; data.
        Deletion is real — we tell you exactly what happens and when.
      </Alert>
    </div>
  );
}
