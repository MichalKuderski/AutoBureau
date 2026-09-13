"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MemberKindSchema, type MemberView } from "@autobureau/contracts";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useCollection } from "@/lib/domain/collection";
import { useHousehold } from "@/providers/household-provider";
import { Button } from "@/components/ui/button";
import { TextInput, Select } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { SkeletonList } from "@/components/ui/skeleton";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { CollectionMore } from "@/components/patterns/collection-more";
import { useToast } from "@/components/ui/toast";
import { initialsOf } from "@/lib/format";

type Action = { kind: "create" } | { kind: "edit" | "archive"; person: MemberView };
export function MemberSettings() {
  const { household, can } = useHousehold();
  const client = useQueryClient(), router = useRouter();
  const { toast } = useToast();
  const [archived, setArchived] = useState(false);
  const [viewedAt] = useState(() => Date.now());
  const [action, setAction] = useState<Action | null>(null);
  const base = `/households/${household.id}/members`;
  const query = useCollection<MemberView>(["members", household.id, archived], household.id, `${base}?archived=${archived}`);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["members", household.id] }); router.refresh(); };
  const archive = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/${id}`, { method: "DELETE", householdId: household.id }),
    onSuccess: async () => { await refresh(); setAction(null); toast({ tone: "success", title: "Person archived", description: "Their records are preserved. You can restore them for 30 days." }); },
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}/${id}/restore`, { method: "POST", householdId: household.id, body: {} }),
    onSuccess: async () => { await refresh(); toast({ tone: "success", title: "Person restored" }); },
  });
  const open = (next: Action) => { archive.reset(); restore.reset(); setAction(next); };
  return <Card>
    <CardHeader><div><CardTitle>People</CardTitle><CardDescription>Everyone whose paperwork you manage. Adding a person does not create a login or send an invitation.</CardDescription></div></CardHeader>
    <CardContent>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {can("manage") && <Button size="sm" onClick={() => open({ kind: "create" })}>Add someone</Button>}
        <Button variant="ghost" size="sm" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? "Show active people" : "Show archived people"}</Button>
      </div>
      {restore.isError && <Alert tone="critical" title="Couldn’t restore this person">{restore.error.message}</Alert>}
      {query.isPending ? <SkeletonList count={2} /> : query.isError ? <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} /> : query.data.length === 0 ?
        <EmptyState title={archived ? "No archived people" : "Who do you look after?"} description={archived ? "Archived people stay here with their records preserved." : "Add yourself or someone whose paperwork you manage."} /> :
        <ul className="divide-y divide-line">{query.data.map((person) => <li key={person.id} className="flex flex-wrap items-center gap-3 py-3">
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent">{initialsOf(person.display_name)}</span>
          <div className="min-w-0 flex-1"><span className="block truncate text-sm">{person.display_name}</span><span className="text-xs capitalize text-ink-tertiary">{person.kind}</span></div>
          {can("manage") && (person.archived_at ? <Button size="sm" variant="secondary" loading={restore.isPending && restore.variables === person.id} disabled={restore.isPending || viewedAt - Date.parse(person.archived_at) > 30 * 86_400_000} onClick={() => restore.mutate(person.id)}>Restore<span className="sr-only"> {person.display_name}</span></Button> : <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => open({ kind: "edit", person })}>Edit<span className="sr-only"> {person.display_name}</span></Button>
            <Button variant="ghost" size="sm" onClick={() => open({ kind: "archive", person })}>Archive<span className="sr-only"> {person.display_name}</span></Button>
          </div>)}
        </li>)}</ul>}
      <CollectionMore query={query} />
      {archived && <p className="mt-3 text-xs text-ink-tertiary">Restore is available for 30 days and uses an active-person slot on your plan.</p>}
      {action?.kind === "create" || action?.kind === "edit" ? <MemberForm key={action.kind === "edit" ? action.person.id : "new"} person={action.kind === "edit" ? action.person : undefined} base={base} householdId={household.id} onClose={() => setAction(null)} onSaved={async () => { await refresh(); setAction(null); }} /> : null}
      <Modal open={action?.kind === "archive"} onClose={() => { if (!archive.isPending) setAction(null); }} title="Archive this person?" size="sm" footer={<><Button variant="ghost" disabled={archive.isPending} onClick={() => setAction(null)}>Cancel</Button><Button variant="danger" loading={archive.isPending} onClick={() => { if (action?.kind === "archive") archive.mutate(action.person.id); }}>Archive person</Button></>}>
        <p className="text-sm text-ink-secondary">They will leave the active people list. Their documents, items and obligations stay preserved; archiving does not delete records or cancel deadlines. You can restore them for 30 days.</p>
        {archive.isError && <Alert tone="critical" title="Couldn’t archive this person">{archive.error.message}</Alert>}
      </Modal>
    </CardContent>
  </Card>;
}

function MemberForm({ person, base, householdId, onClose, onSaved }: { person?: MemberView | undefined; base: string; householdId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(person?.display_name ?? "");
  const [kind, setKind] = useState<string>(person?.kind ?? "adult");
  const [birthday, setBirthday] = useState(person?.date_of_birth ?? "");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => apiFetch<MemberView>(person ? `${base}/${person.id}` : base, {
      method: person ? "PATCH" : "POST", householdId, body: { display_name: name, kind, date_of_birth: birthday || null },
    }),
    onSuccess: async () => { await onSaved(); toast({ tone: "success", title: person ? "Person updated" : "Person added" }); },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return <Modal open onClose={() => { if (!save.isPending) onClose(); }} title={person ? "Edit person" : "Add someone"}>
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} disabled={save.isPending} error={errors["display_name"]} data-autofocus />
      <Select label="Person or group" value={kind} onChange={(event) => setKind(event.target.value)} options={MemberKindSchema.options.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} disabled={save.isPending} error={errors["kind"]} />
      <TextInput label="Date of birth (optional)" type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} max={today} disabled={save.isPending} error={errors["date_of_birth"]} />
      {save.isError && <Alert tone="critical" title="Couldn’t save this person">{save.error.message}</Alert>}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} loadingLabel="Saving person">{person ? "Save changes" : "Add person"}</Button></div>
    </form>
  </Modal>;
}
