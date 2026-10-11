// IPC and output are a closed vocabulary, never strings taken from an exception.
export const stages=Object.freeze(['LOCAL_SETUP','CONNECT','READ_ONLY_CONFIRMATION','DATABASE_ROLE',
  'MIGRATION_CHECKSUMS','SCHEMA_POSTURE','TRANSACTION_COMPLETED','DISCONNECT']);
export const reasons=Object.freeze(['NONE','UNKNOWN','LOCAL_SETUP_FAILURE','AUTH_REJECTED','UNREACHABLE',
  'SERVER_TIMEOUT','DATABASE_MISSING','ACCESS_DENIED','TLS_FAILURE','OPERATION_TIMEOUT','POOL_TIMEOUT',
  'TRANSACTION_FAILURE','CONNECTION_CLOSED','READ_ONLY_FAILURE','IDENTITY_MISMATCH','LEDGER_MISMATCH',
  'SCHEMA_MISMATCH','WORKER_FAILURE','PROTOCOL_FAILURE','WATCHDOG_TIMEOUT','REPORTED_FAILURE']);
const codes=new Map([['P1000','AUTH_REJECTED'],['P1001','UNREACHABLE'],['P1002','SERVER_TIMEOUT'],
  ['P1003','DATABASE_MISSING'],['P1008','OPERATION_TIMEOUT'],['P1010','ACCESS_DENIED'],
  ['P1011','TLS_FAILURE'],['P1017','CONNECTION_CLOSED'],['P2024','POOL_TIMEOUT'],['P2028','TRANSACTION_FAILURE']]);
export function structuredReason(error) {
  // Read only own data properties, never getters, messages, causes or provider meta.
  try {
    const first=Object.getOwnPropertyDescriptor(error,'errorCode');
    const second=Object.getOwnPropertyDescriptor(error,'code');
    if ([first,second].some(d=>d && !Object.hasOwn(d,'value'))) return 'UNKNOWN';
    const a=first?.value,b=second?.value;
    if (a !== undefined && b !== undefined && a !== b) return 'UNKNOWN';
    return codes.get(a ?? b) ?? 'UNKNOWN';
  } catch {return 'UNKNOWN';}
}
export const blankResults=()=>stages.map(()=>({status:'NOT_RUN',reason:'NONE'}));
export function formatResults(authority,routing,outcome) {
  return [`AUTHORITY ${authority}`,`ROUTING ${routing}`,
    ...stages.map((s,i)=>`${s} ${outcome.results[i].status}${outcome.results[i].status==='FAIL'?' '+outcome.results[i].reason:''}`),
    `PROCESS_COMPLETION ${outcome.reason==='NOT_RUN'?'NOT_RUN':outcome.ok?'PASS':'FAIL '+outcome.reason}`].join('\n')+'\n';
}
