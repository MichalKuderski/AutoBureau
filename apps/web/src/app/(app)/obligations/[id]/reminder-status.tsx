"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { useHousehold } from "@/providers/household-provider";

interface ReminderRows {
  deliveryActive: false;
  reminders: Array<{ remindAt: string; offsetLabel: string; status: "scheduled" | "sent" | "skipped" | "cancelled"; sentAt: string | null }>;
}
/**
 * Reminder and delivery status. It never says a reminder was sent unless the row records a
 * send time, and while delivery is not active it says plainly that nothing will be sent —
 * a planned reminder is not a promise of delivery.
 */
export function ReminderStatus({ obligationId }: { obligationId: string }) {
  const { household } = useHousehold();
  const q = useQuery({ queryKey: ["household", household.id, "obligation-reminders", obligationId],
    queryFn: () => apiFetch<ReminderRows>(`/obligations/${obligationId}/reminders`, { householdId: household.id }) });
  const when = (iso: string) => new Date(iso).toLocaleString(household.locale, { dateStyle: "medium", timeStyle: "short", timeZone: household.timezone });
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Reminders</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        {q.isPending ? <p role="status" className="text-sm text-ink-secondary">Loading reminders…</p>
          : q.isError || !Array.isArray(q.data?.reminders) ? <p role="status" className="text-sm text-ink-secondary">Reminder status is unavailable right now.</p>
          : (
            <>
              {!q.data.deliveryActive ? (
                <p role="status" className="text-sm text-ink-secondary">
                  Reminder delivery isn't active in this preview, so no reminder will be sent for this deadline. Keep an eye on it here.
                </p>
              ) : null}
              {q.data.reminders.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {q.data.reminders.map(r => (
                    <li key={`${r.offsetLabel}-${r.remindAt}`} className="text-ink-secondary">
                      {r.offsetLabel}: {r.status === "sent" && r.sentAt ? `sent ${when(r.sentAt)}` : r.status === "cancelled" ? "cancelled"
                        : r.status === "skipped" ? "skipped" : `planned for ${when(r.remindAt)}, not sent`}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-tertiary">No reminders are planned for this deadline.</p>}
            </>
          )}
      </CardContent>
    </Card>
  );
}
