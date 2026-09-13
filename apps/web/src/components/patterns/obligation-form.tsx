"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ObligationCreateSchema, ObligationKindSchema, type ObligationCreate } from "@autobureau/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import { deadlineInstants, deadlineLocal } from "@/lib/deadline-time";
import { parseCents } from "@/lib/format";
import { queryKeys, useItems } from "@/lib/domain/queries";
import type { ObligationView } from "@/lib/domain/types";
import { useHousehold } from "@/providers/household-provider";
import { Modal } from "@/components/ui/modal";
import { TextInput, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CollectionMore } from "./collection-more";

const kinds = ObligationKindSchema.options.map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }));
export function ObligationForm({ obligation, onClose, onSaved }: { obligation?: ObligationView; onClose: () => void; onSaved: (value: ObligationView) => void }) {
  const { household } = useHousehold(), qc = useQueryClient();
  const items = useItems(household.id);
  const initial = obligation ? deadlineLocal(obligation.due_at, household.timezone) : null;
  const [title, setTitle] = useState(obligation?.title ?? ""), [kind, setKind] = useState<ObligationCreate["kind"]>(obligation?.kind ?? "custom");
  const [member, setMember] = useState(obligation?.member_id ?? ""), [item, setItem] = useState(obligation?.item_id ?? "");
  const [date, setDate] = useState(initial?.date ?? ""), [time, setTime] = useState(initial?.time ?? ""), [choice, setChoice] = useState(initial?.choice ?? "");
  const [direction, setDirection] = useState<ObligationCreate["direction"]>(obligation?.direction ?? "owed_by_household");
  const [amount, setAmount] = useState(obligation?.amount_cents == null ? "" : (obligation.amount_cents / 100).toFixed(2)), [priority, setPriority] = useState<1 | 2 | 3>(obligation?.priority ?? 2);
  const currency = obligation?.currency ?? "USD";
  const [error, setError] = useState<string | null>(null);
  const instants = deadlineInstants(date, time, household.timezone);
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (body: ObligationCreate) => {
      const serialized = JSON.stringify(body);
      if (requestKey.current?.body !== serialized) requestKey.current = { body: serialized, key: crypto.randomUUID() };
      return apiFetch<ObligationView>(obligation ? `/obligations/${obligation.id}` : "/obligations", { method: obligation ? "PATCH" : "POST", householdId: household.id, body, idempotencyKey: requestKey.current.key });
    },
    onSuccess: async (saved) => {
      qc.setQueryData(queryKeys.obligation(household.id, saved.id), saved);
      await Promise.all([qc.invalidateQueries({ queryKey: ["obligations", household.id] }),
        qc.invalidateQueries({ queryKey: ["items", household.id] }),
        qc.invalidateQueries({ queryKey: queryKeys.summary(household.id) }),
        qc.invalidateQueries({ queryKey: queryKeys.timeline(household.id) })]);
      onSaved(saved);
    },
  });
  const memberOptions = [{ value: "", label: "Whole household" }, ...household.members.map((person) => ({ value: person.id, label: person.displayName }))];
  if (obligation?.member_id && !memberOptions.some((option) => option.value === obligation.member_id)) memberOptions.push({ value: obligation.member_id, label: `${obligation.member_name ?? "Person"} (archived)` });
  const itemOptions = [{ value: "", label: items.isPending ? "Loading records…" : "No linked record" }, ...items.data.filter((record) => record.status !== "archived").map((record) => ({ value: record.id, label: record.name }))];
  if (obligation?.item_id && !itemOptions.some((option) => option.value === obligation.item_id)) itemOptions.push({ value: obligation.item_id, label: obligation.item_name ?? "Current linked record" });
  return <Modal open title={obligation ? "Edit deadline" : "Add deadline"} description="Enter a date you have confirmed. It will be recorded as provided by you."
    onClose={() => { if (!mutation.isPending) onClose(); }}>
    <form className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (mutation.isPending) return;
      if (!instants.length) { setError("That date and time do not exist in your selected timezone. Check the date and daylight-saving change."); return; }
      const unchangedTime = initial && date === initial.date && time === initial.time && choice === initial.choice;
      const instant = unchangedTime ? initial : instants.length === 1 ? instants[0] : instants.find((value) => value.iso === choice);
      if (!instant) { setError("This clock time happens twice. Choose which occurrence you mean."); return; }
      const cents = parseCents(amount);
      if (amount.trim() && cents === null) { setError("Enter an amount with no more than two decimal places."); return; }
      const parsed = ObligationCreateSchema.safeParse({ title, kind, direction, priority, due_at: instant.iso,
        member_id: member || null, item_id: item || null, amount_cents: cents, currency: cents === null ? null : currency });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check these details."); return; }
      setError(null); mutation.mutate(parsed.data);
    }}>
      <fieldset disabled={mutation.isPending} className="flex min-w-0 flex-col gap-4">
        <TextInput label="Deadline title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} />
        <Select label="Kind of deadline" options={kinds} value={kind} onChange={(event) => setKind(event.target.value as ObligationCreate["kind"])} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Due date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setChoice(""); }} required />
          <TextInput label="Due time" type="time" step="1" value={time} onChange={(event) => { setTime(event.target.value); setChoice(""); }} required />
        </div>
        <p className="text-sm text-ink-secondary">Time zone: {household.timezone}. Change your preferred timezone in Profile settings.</p>
        {instants.length > 1 && <Select label="Which occurrence?" value={choice} onChange={(event) => setChoice(event.target.value)}
          options={[{ value: "", label: "Choose an occurrence" }, ...instants.map((value, index) => ({ value: value.iso, label: `${index === 0 ? "First" : "Second"} occurrence — UTC${value.offset}` }))]} />}
        <Select label="Who this is for" value={member} onChange={(event) => setMember(event.target.value)}
          options={memberOptions} />
        <Select label="Related record (optional)" value={item} onChange={(event) => setItem(event.target.value)} disabled={items.isPending}
          options={itemOptions} />
        {items.isError && <p role="alert" className="text-sm text-critical">Couldn’t load records. You can save without a link or <button type="button" className="underline" onClick={() => void items.refetch()}>retry loading records</button>.</p>}
        <CollectionMore query={items} />
        <Select label="Direction" value={direction} onChange={(event) => setDirection(event.target.value as ObligationCreate["direction"])}
          options={[{ value: "owed_by_household", label: "Something we need to do" }, { value: "owed_to_household", label: "Something owed to us" }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={`Amount in ${currency} (optional)`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          <Select label="Priority" value={String(priority)} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3)}
            options={[{ value: "1", label: "High" }, { value: "2", label: "Normal" }, { value: "3", label: "Low" }]} />
        </div>
      </fieldset>
      <p className="text-xs text-ink-secondary">Keep account and identity numbers out of the title. This saves a deadline; reminder delivery is not enabled yet.</p>
      {(error || mutation.isError) && <Alert tone="critical" title="Couldn’t save this deadline">{error ?? (mutation.error instanceof ApiError ? mutation.error.message : "Your details are still here. Please try again.")}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" type="submit" loading={mutation.isPending} loadingLabel="Saving deadline">Save deadline</Button>
      </div>
    </form>
  </Modal>;
}
