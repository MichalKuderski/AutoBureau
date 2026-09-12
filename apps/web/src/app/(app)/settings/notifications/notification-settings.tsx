"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotificationSettingsSaveSchema, type NotificationSettingsSave, type NotificationSettingsView } from "@autobureau/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toggle, Select, TextInput } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { useToast } from "@/components/ui/toast";
import { useHousehold } from "@/providers/household-provider";
import { apiFetch } from "@/lib/api-client";

const KINDS = [
  { id: "obligation.due_soon", label: "Deadline reminders", description: "Reminders for confirmed dates." },
  { id: "document.needs_review", label: "Documents needing a look", description: "Documents waiting for your review." },
  { id: "digest.weekly", label: "Weekly digest", description: "A summary of your household's saved deadlines." },
  { id: "value.found", label: "Value updates", description: "Updates about potential savings and money owed to you." },
  { id: "security", label: "Security notices", description: "Important account changes. Always enabled." },
] as const;
const channels = ["email", "push", "inapp"] as const;
const channelName = { email: "Email", push: "Push", inapp: "In app" };
const key = (h: string) => ["notification-settings", h] as const;
export function NotificationSettings() {
  const { household } = useHousehold();
  const query = useQuery({ queryKey: key(household.id), queryFn: ({ signal }) => apiFetch<NotificationSettingsView>("/me/notification-settings", { householdId: household.id, signal }) });
  if (query.isPending) return <SkeletonList count={3} />;
  if (query.isError) return <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={household.id} initial={query.data} />;
}
function SettingsForm({ initial }: { initial: NotificationSettingsView }) {
  const { household, can } = useHousehold();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<NotificationSettingsSave>({ preferences: initial.preferences, schedule: initial.schedule });
  const [validation, setValidation] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (body: NotificationSettingsSave) => apiFetch<NotificationSettingsView>("/me/notification-settings", { method: "PATCH", householdId: household.id, body }),
    onSuccess: (saved) => { setDraft({ preferences: saved.preferences, schedule: saved.schedule }); qc.setQueryData(key(household.id), saved); toast({ tone: "success", title: "Preferences saved" }); } });
  const disabled = save.isPending || !can("manage");
  const schedule = <K extends keyof NotificationSettingsSave["schedule"]>(name: K, value: NotificationSettingsSave["schedule"][K]) => setDraft((prev) => ({ ...prev, schedule: { ...prev.schedule, [name]: value } }));
  return <form className="flex flex-col gap-6" onSubmit={(event) => {
    event.preventDefault(); if (disabled) return;
    const parsed = NotificationSettingsSaveSchema.safeParse(draft);
    setValidation(parsed.success ? null : parsed.error.issues[0]?.message ?? "Check your preferences.");
    if (parsed.success) save.mutate(parsed.data);
  }}>
    <Alert tone="info" title="Delivery is being set up">Save your choices below. Email and push delivery are not active yet; enabling a channel does not register this device for push.</Alert>
    {!can("manage") && <Alert tone="info" title="Owner access required">Only a household owner can change notification settings.</Alert>}
    <Card><CardHeader><CardTitle>What you hear from us</CardTitle><CardDescription>Choose each channel separately. Security notices stay enabled.</CardDescription></CardHeader>
      <CardContent><div className="flex flex-col divide-y divide-line">
        {KINDS.map((kind) => <fieldset key={kind.id} disabled={disabled} className="py-4 first:pt-0 last:pb-0">
          <legend className="sr-only">{kind.label}</legend><p className="text-sm font-medium text-ink">{kind.label}</p><p className="mt-1 text-xs text-ink-tertiary">{kind.description}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">{channels.map((channel) => <label key={channel} className="flex min-h-8 items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={draft.preferences.find((row) => row.kind === kind.id && row.channel === channel)?.enabled ?? false}
              disabled={disabled || kind.id === "security"} aria-label={`${kind.label} via ${channelName[channel]}`}
              onChange={(event) => setDraft((prev) => ({ ...prev, preferences: prev.preferences.map((row) => row.kind === kind.id && row.channel === channel ? { ...row, enabled: event.target.checked } : row) }))}
              className="size-4 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50" />{channelName[channel]}
          </label>)}</div>
        </fieldset>)}
      </div></CardContent></Card>
    <Card><CardHeader><CardTitle>Quiet hours</CardTitle><CardDescription>Local times in {initial.timezone}. Non-urgent delivery waits until quiet hours end.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-2">
        <TextInput type="time" label="From" value={draft.schedule.quiet_start} onChange={(event) => schedule("quiet_start", event.target.value)} required disabled={disabled} />
        <TextInput type="time" label="Until" value={draft.schedule.quiet_end} onChange={(event) => schedule("quiet_end", event.target.value)} required disabled={disabled} />
      </div><Toggle label="Let urgent deadlines through" description="Opt in to critical reminders during quiet hours when a deadline is within 24 hours." checked={draft.schedule.urgent_override} onChange={(value) => schedule("urgent_override", value)} disabled={disabled} /></CardContent>
    </Card>
    <Card><CardHeader><CardTitle>Weekly digest schedule</CardTitle><CardDescription>The saved schedule uses your profile timezone.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
      <Select label="Day" value={String(draft.schedule.digest_day)} onChange={(event) => schedule("digest_day", Number(event.target.value))} disabled={disabled}
        options={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ value: String(i), label }))} />
      <TextInput type="time" label="Time" value={draft.schedule.digest_time} onChange={(event) => schedule("digest_time", event.target.value)} required disabled={disabled} />
    </CardContent></Card>
    {validation && <Alert tone="critical" title="Check your preferences">{validation}</Alert>}
    {save.isError && <Alert tone="critical" title="Couldn’t save preferences">{save.error.message} Your changes are still in this form.</Alert>}
    <div><Button type="submit" variant="primary" disabled={!can("manage")} loading={save.isPending} loadingLabel="Saving preferences">Save preferences</Button></div>
  </form>;
}
