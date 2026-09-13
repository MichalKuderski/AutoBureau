"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ItemCreateSchema, ItemKindSchema, type ItemCreate } from "@autobureau/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";
import { parseCents } from "@/lib/format";
import type { ItemView } from "@/lib/domain/types";
import { queryKeys } from "@/lib/domain/queries";
import { useHousehold } from "@/providers/household-provider";
import { Modal } from "@/components/ui/modal";
import { TextInput, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const kinds = ItemKindSchema.options.map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }));
const cycles = [{ value: "", label: "Not specified" }, { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" }, { value: "annually", label: "Annually" }, { value: "one_time", label: "One time" }];

/** Mounted once per edit: a dismissed draft never becomes a later record's form. */
export function ItemForm({ item, onClose, onSaved }: {
  item?: ItemView; onClose: () => void; onSaved: (item: ItemView) => void;
}) {
  const { household } = useHousehold();
  const qc = useQueryClient();
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState(item?.kind ?? "other");
  const [member, setMember] = useState(item?.member_id ?? "");
  const [vendor, setVendor] = useState(item?.vendor_name ?? "");
  const [amount, setAmount] = useState(item?.amount_cents == null ? "" : (item.amount_cents / 100).toFixed(2));
  const [currency, setCurrency] = useState(item?.currency ?? "USD");
  const [cycle, setCycle] = useState(item?.billing_cycle ?? "");
  const [start, setStart] = useState(item?.valid_from ?? "");
  const [expiry, setExpiry] = useState(item?.expires_at ?? "");
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (body: ItemCreate) => {
      // Keep one key for retries of the same submission. A new random key on a
      // network retry could duplicate a record whose first response was lost.
      const serialized = JSON.stringify(body);
      if (requestKey.current?.body !== serialized) requestKey.current = { body: serialized, key: crypto.randomUUID() };
      return apiFetch<ItemView>(item ? `/items/${item.id}` : "/items", { method: item ? "PATCH" : "POST",
        householdId: household.id, body, idempotencyKey: requestKey.current.key });
    },
    onSuccess: async (saved) => {
      qc.setQueryData(queryKeys.item(household.id, saved.id), saved);
      await Promise.all([qc.invalidateQueries({ queryKey: ["items", household.id] }),
        qc.invalidateQueries({ queryKey: queryKeys.summary(household.id) }),
        qc.invalidateQueries({ queryKey: ["obligations", household.id] }),
        qc.invalidateQueries({ queryKey: ["obligation", household.id] }),
        qc.invalidateQueries({ queryKey: queryKeys.timeline(household.id) })]);
      onSaved(saved);
    },
  });
  const memberOptions = [{ value: "", label: "Whole household" }, ...household.members.map((person) => ({ value: person.id, label: person.displayName }))];
  if (item?.member_id && !memberOptions.some((option) => option.value === item.member_id)) memberOptions.push({ value: item.member_id, label: `${item.member_name ?? "Person"} (archived)` });
  return <Modal open title={item ? "Edit item" : "Add item"} description="Save the details you know. Leave anything uncertain empty."
    onClose={() => { if (!mutation.isPending) onClose(); }}>
    <form className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (mutation.isPending) return;
      const parsedMoney = parseCents(amount);
      if (amount.trim() && parsedMoney === null) { setError("Enter an amount with no more than two decimal places."); return; }
      const parsed = ItemCreateSchema.safeParse({ name, kind, member_id: member || null, vendor_name: vendor.trim() || null,
        amount_cents: parsedMoney, currency: parsedMoney === null ? null : currency, billing_cycle: cycle || null,
        valid_from: start || null, expires_at: expiry || null });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check these details."); return; }
      setError(null);
      mutation.mutate(parsed.data);
    }}>
      <fieldset disabled={mutation.isPending} className="flex min-w-0 flex-col gap-4">
        <TextInput label="Item name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
        <Select label="Kind of record" options={kinds} value={kind} onChange={(event) => setKind(event.target.value as ItemView["kind"])} />
        <Select label="Who it belongs to" options={memberOptions} value={member} onChange={(event) => setMember(event.target.value)} />
        <TextInput label="Provider or organization (optional)" value={vendor} onChange={(event) => setVendor(event.target.value)} maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Amount (optional)" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          <Select label="Currency" options={[{ value: "USD", label: "USD — US dollar" }, ...(item?.currency && item.currency !== "USD" ? [{ value: item.currency, label: item.currency }] : [])]} value={currency} onChange={(event) => setCurrency(event.target.value)} />
          <Select label="Billing frequency" options={cycle && !cycles.some((option) => option.value === cycle) ? [...cycles, { value: cycle, label: cycle }] : cycles} value={cycle} onChange={(event) => setCycle(event.target.value)} />
          <TextInput label="Start date (optional)" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          <TextInput label="Expiry date (optional)" type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </div>
      </fieldset>
      <p className="text-xs text-ink-secondary">Use a descriptive name. Keep account, policy and identity numbers out of these fields. Saving an expiry date does not schedule a reminder.</p>
      {(error || mutation.isError) && <Alert tone="critical" title="Couldn’t save this item">{error ?? (mutation.error instanceof ApiError ? mutation.error.message : "Your changes are still here. Please try again.")}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" loading={mutation.isPending} loadingLabel="Saving item">Save item</Button>
      </div>
    </form>
  </Modal>;
}
