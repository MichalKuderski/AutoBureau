// Pure fail-closed planner; no network, credentials, shell, or deployment capability.
export function plan({phase, manifest, local, ledger, context}) {
  const phases = Object.keys(manifest.phases);
  const i = phases.indexOf(phase);
  if (i < 0) throw Error('Unknown phase');
  if (context.event !== 'workflow_dispatch' || context.ref !== 'refs/heads/main' ||
      context.actor !== 'MichalKuderski' || context.triggeringActor !== 'MichalKuderski' || !/^[a-f0-9]{40}$/.test(context.sha) ||
      context.approval !== `${phase}:${context.sha}:${manifest.project}`)
    throw Error('Exact owner approval for main required');
  if (!/^https:\/\/github.com\/MichalKuderski\/AutoBureau\/(issues|pull)\/\d+#issuecomment-\d+$/.test(context.evidence ?? ''))
    throw Error('Recorded execution/recovery decision required');
  if (phase === 'resume' && (!/^[a-f0-9]{40}$/.test(context.runtimeSha ?? '') ||
      !/^https:\/\/autobureau-staging-[a-z0-9]+-data-analyst-mike\.vercel\.app$/.test(context.runtimeUrl ?? '') ||
      !/^https:\/\/github.com\/MichalKuderski\/AutoBureau\/actions\/runs\/\d+$/.test(context.acceptance ?? '')))
    throw Error('Owner-attested runtime/acceptance identity required');
  const all = {...manifest.baseline};
  for (const p of phases) all[manifest.phases[p].name] = manifest.phases[p].sha256;
  if (JSON.stringify(Object.entries(local).sort()) !== JSON.stringify(Object.entries(all).sort()))
    throw Error('Local immutable migration inventory differs');
  const before = {...manifest.baseline};
  for (const p of phases.slice(0,i)) before[manifest.phases[p].name] = manifest.phases[p].sha256;
  if (ledger.length !== Object.keys(before).length || new Set(ledger.map(r=>r.migration_name)).size !== ledger.length)
    throw Error('Ledger cardinality differs');
  for (const row of ledger)
    if (!row.finished_at || row.rolled_back_at || before[row.migration_name] !== row.checksum)
      throw Error('Ledger state/checksum differs');
  const next = manifest.phases[phase];
  return {phase, before, after: {...before,[next.name]:next.sha256}, pending:next.name};
}

export async function execute(plan, adapter) {
  await adapter.precheck(plan);
  // Exactly one attempt. A failure/uncertain outcome never runs a later phase or retries.
  await adapter.migrate(plan);
  await adapter.postcheck(plan);
}
