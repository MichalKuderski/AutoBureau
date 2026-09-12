"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Household } from "@autobureau/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";
import { MemberSettings } from "./member-settings";
import { ApiError, apiFetch } from "@/lib/api-client";

/**
 * Household settings — members and the ingestion alias.
 *
 * The alias is the retention feature (H1/H7): it is presented prominently and with a
 * plain explanation of what happens to mail sent there, because the just-in-time
 * notice at the moment of enabling ingestion is a privacy commitment (doc 13 §3),
 * not fine print.
 */
export function HouseholdSettings() {
  const { household, can } = useHousehold();
  const { toast } = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const [name, setName] = useState(household.name);
  const alias = household.emailAlias;
  const save = useMutation({
    mutationFn: () => apiFetch<Household>(`/households/${household.id}`, {
      method: "PATCH", householdId: household.id, body: { name },
    }),
    onSuccess: async (saved) => {
      setName(saved.name);
      await client.invalidateQueries({ queryKey: ["household", "current"] });
      router.refresh();
      toast({ tone: "success", title: "Saved", description: "Household updated." });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
          <CardDescription>
            Choose a name for the household whose paperwork you manage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!save.isPending && can("manage")) save.mutate(); }}>
          <TextInput
            label="Household name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required maxLength={200} disabled={!can("manage") || save.isPending}
            error={save.error instanceof ApiError ? save.error.fieldErrors["name"] : undefined}
          />
          {save.isError && <Alert tone="critical" title="Couldn’t save your household">{save.error.message}</Alert>}
          {!can("manage") && <p className="text-sm text-ink-secondary">Only the household owner can change these settings.</p>}
          <div>
            <Button
              variant="primary"
              size="sm"
              type="submit" loading={save.isPending} loadingLabel="Saving household" disabled={!can("manage")}
            >
              Save changes
            </Button>
          </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forwarding address</CardTitle>
          <CardDescription>
            Only an address actually assigned to your household appears here. Forwarding
            ingestion is not enabled in this preview.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {alias ? <div className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5">
            <Icon.Documents className="size-4 shrink-0 text-ink-tertiary" />
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{alias}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  if (!navigator.clipboard) throw new Error("Clipboard unavailable");
                  await navigator.clipboard.writeText(alias);
                  toast({ tone: "success", title: "Copied", description: "Address copied." });
                } catch {
                  toast({ tone: "critical", title: "Couldn’t copy the address", description: "Select and copy the address manually." });
                }
              }}
            >
              Copy
            </Button>
          </div> : <Alert tone="info" title="No forwarding address yet">
            An address will appear here once forwarding is configured for your household.
          </Alert>}
        </CardContent>
      </Card>

      <MemberSettings />
    </div>
  );
}
