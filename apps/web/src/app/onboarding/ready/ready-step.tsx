"use client";

import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StepFooter } from "../onboarding-shell";
import { useOnboarding } from "../onboarding-provider";

/** A saved census is an unverified record, never evidence for a dated obligation. */
export function ReadyStep() {
  const router = useRouter();
  const { seed, censusSubject, members, recordsSaved, dirty, save, saving, saveError } = useOnboarding();
  return <>
    <h1 className="text-2xl leading-tight sm:text-3xl">Here's your starting point</h1>
    <p className="mt-2 max-w-xl text-ink-secondary">Your household is created. Your answers give the ledger a starting point; dates and details still need confirmation.</p>
    <Alert className="mt-6" tone="info" title={dirty ? "Some answers haven't been saved" : "Your census answers are saved"}>
      {dirty ? "Save and continue below to keep these changes." : `${recordsSaved} ${recordsSaved === 1 ? "record is" : "records are"} saved from these answers. No dated obligations or reminders were created.`}
    </Alert>
    {seed.items.length === 0 ? <EmptyState className="mt-7" icon={<Icon.Household className="size-5" />} title="A clear starting point"
      description="You can add records by hand from your household. Sending documents isn't available yet." /> : <div className="mt-7 flex flex-col gap-5">
      <Card><CardHeader><CardTitle>What you ticked{censusSubject ? ` for ${censusSubject.displayName.trim()}` : ""}</CardTitle></CardHeader>
        <CardContent><ul className="flex flex-wrap gap-2">{seed.items.map((item) => <li key={item.promptId}><Chip tone="neutral">{item.name}</Chip></li>)}</ul>
          <p className="mt-3 text-sm text-ink-secondary">These records come from your answers and remain unverified.</p>
        </CardContent></Card>
      {seed.obligations.length > 0 && <Card><CardHeader><CardTitle>Deadlines you flagged</CardTitle></CardHeader><CardContent>
        <p className="mb-3 text-sm text-ink-secondary">You told us these exist. No date has been assumed and nothing is scheduled.</p>
        <ul className="flex flex-col divide-y divide-line">{seed.obligations.map((obligation) => <li key={obligation.promptId} className="flex gap-3 py-3">
          <div className="min-w-0 flex-1"><p className="text-sm">{obligation.title}</p><p className="text-xs text-ink-secondary">Needs {obligation.needs}</p></div>
          <Chip tone="warning" size="sm">Date unknown</Chip>
        </li>)}</ul>
      </CardContent></Card>}
    </div>}
    {members.length > 0 && <p className="mt-6 text-sm text-ink-secondary">People in this setup: {members.filter((member) => member.displayName.trim()).map((member) => member.displayName.trim()).join(", ")}.</p>}
    {saveError && <Alert className="mt-5" tone="critical" title="Couldn’t finish your setup">{saveError}</Alert>}
    <StepFooter note="Document processing and reminder delivery are still being built. You can already save and edit records in your household.">
      <Button variant="primary" loading={saving} loadingLabel="Saving setup" onClick={async () => { if (await save("complete")) router.push("/dashboard"); }}>
        Save and open your household<Icon.ChevronRight className="size-4" />
      </Button>
    </StepFooter>
  </>;
}
