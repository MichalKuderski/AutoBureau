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
 * Two-step verification is shown disabled rather than omitted (blueprint P0-03): no MFA
 * mechanism exists yet — not TOTP, not WebAuthn, nothing an enrolled factor could check
 * a code against — so the control must not claim otherwise. Doc 06 §1 sets the eventual
 * shape (offered once the household holds identifier-grade values, not demanded up
 * front); this component doesn't get to imply that shape exists before it does.
 */
export function ProfileSettings() {
  const { viewer } = useHousehold();
  const { toast } = useToast();
  const [name, setName] = useState(viewer.displayName);

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
          {/*
           * Blueprint P0-03. This was a local boolean that toasted "Two-step
           * verification on — You'll be asked for a code on new devices." with no MFA
           * implementation behind it anywhere in the codebase — a security control that
           * told a user their account was protected when it was not. Disabled rather
           * than removed: it keeps the row where a returning user expects to find it,
           * and `Toggle` already carries a truthful disabled state rather than a second
           * one built for this. `checked` stays `false` and `onChange` is unreachable —
           * a disabled control fires no click — but the prop is required by the type.
           */}
          <Toggle
            label="Two-step verification"
            description="Not available yet — two-step verification is not currently supported."
            checked={false}
            disabled
            onChange={() => {}}
          />
          {/*
           * Blueprint P0-11. This button had no onClick at all — clicking it produced
           * no request, no navigation, no error, nothing. No password-change endpoint
           * or mutation exists anywhere in this repository (the only auth endpoints
           * are sign-in, sign-out, and magic-link). Disabled rather than removed, so
           * the row stays where a returning user expects to find it.
           */}
          <div className="border-t border-line pt-4">
            <Button variant="secondary" size="sm" disabled>
              Change password
            </Button>
            <p className="mt-2 text-xs text-ink-tertiary">Not available yet.</p>
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
          {/*
           * Blueprint P0-11. Same defect as "Change password" above: no onClick, no
           * request, no error. `POST /v1/auth/sign-out` (P0-02) ends only the current
           * session; nothing revokes every other one. Disabled rather than removed.
           */}
          <div>
            <Button variant="ghost" size="sm" disabled>
              Sign out everywhere else
            </Button>
            <p className="mt-2 text-xs text-ink-tertiary">Not available yet.</p>
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
