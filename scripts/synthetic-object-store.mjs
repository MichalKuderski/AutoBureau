/** LOCAL TEST adapter only: synthetic bytes, no cloud/HTTP, credentials, URLs or
 * application import. Task-owned root, closed names, no overwrite or symlink use.
 * Fence ledger is OUTSIDE data snapshots. A hosted backup restore must reconcile
 * an independently protected deletion ledger before serving; this is not that proof. */
import { constants, openSync, closeSync, fstatSync, fsyncSync, writeFileSync, readFileSync, mkdirSync, lstatSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-57][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const categories = ['objects', 'quarantine', 'job-artifacts', 'export-artifacts'];
const deny = () => { throw new Error('Synthetic storage operation refused'); };
const exists = path => { try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
export function syntheticObjectStore(root) {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || realpathSync(root) !== root) deny();
  const dir = path => { const s = exists(path); if (s && (!s.isDirectory() || s.isSymbolicLink())) deny(); if (!s) mkdirSync(path,{mode:0o700}); return path; };
  if (exists(join(root,'data')) && !exists(join(root,'fences'))) deny();
  const data = dir(join(root,'data')), ledger = dir(join(root,'fences'));
  const checked = hh => { if (!uuid(hh)) deny(); return join(ledger,hh); };
  const fenced = hh => {
    const path = checked(hh), s=exists(path); if (!s) return false;
    if (!s.isFile() || s.isSymbolicLink() || s.size !== 8 || readFileSync(path,'utf8') !== 'FENCED1\n') deny();
    return true;
  };
  const writable = hh => { if (fenced(hh)) deny(); };
  const namespace = (category,hh) => { checked(hh); if (!categories.includes(category)) deny(); return dir(join(dir(join(data,category)),hh)); };
  const file = (category,hh,id) => {
    if (!uuid(id) && !(category === 'objects' && id.split('.').length === 2 && id.split('.').every(uuid))) deny();
    return join(namespace(category,hh),id);
  };
  const write = (path,bytes) => {
    const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try { writeFileSync(fd,bytes); fsyncSync(fd); } finally { closeSync(fd); }
    const parent=openSync(join(path,'..'),constants.O_RDONLY); try {fsyncSync(parent);} finally {closeSync(parent);}
  };
  const read = path => {
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try { const stat=fstatSync(fd); if(!stat.isFile()||stat.size>25*1024*1024) deny(); const bytes=readFileSync(fd); if (bytes.length>25*1024*1024) deny(); return bytes; } finally {closeSync(fd);}
  };
  const entries = (category,hh) => {
    const path=namespace(category,hh), names=readdirSync(path); if(names.length>1000) deny();
    for(const name of names) { const p=file(category,hh,name),s=lstatSync(p); if(!s.isFile()||s.isSymbolicLink()) deny(); }
    return names.sort();
  };
  return Object.freeze({
    put(category,hh,id,bytes) {
      writable(hh); if(category==='objects' || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length>25*1024*1024) deny();
      write(file(category,hh,id),bytes);
    },
    seal(hh,documentId,sealId) {
      writable(hh); if(!uuid(documentId)||!uuid(sealId)) deny();
      write(file('objects',hh,`${documentId}.${sealId}`),read(file('quarantine',hh,documentId)));
    },
    snapshots(hh) { checked(hh); return Object.freeze({load:async ({documentId,sealId,size},signal) => {
      writable(hh); if(signal.aborted||!uuid(documentId)||!uuid(sealId)) deny();
      const bytes=read(file('objects',hh,`${documentId}.${sealId}`)); if(bytes.length!==size) deny(); return bytes;
    }}); },
    fence(hh) {
      const path=checked(hh); if(fenced(hh)) return; write(path,Buffer.from('FENCED1\n'));
    },
    inventory(category,hh) { return Object.freeze({scope:'local-synthetic',count:entries(category,hh).length}); },
    erase(category,hh) {
      if(!fenced(hh)) deny(); const names=entries(category,hh).slice(0,100);
      for(const name of names) unlinkSync(file(category,hh,name));
      const fd=openSync(namespace(category,hh),constants.O_RDONLY);try {fsyncSync(fd);} finally {closeSync(fd);}
      return Object.freeze({acknowledged:true,count:names.length,absenceProven:false});
    },
    observe(category,hh) {
      try { const remaining=entries(category,hh).length;
        return Object.freeze({evidenceId:randomUUID(),source:'synthetic',state:remaining?'remaining':'absent',remaining,finalReceiptIssuable:false});
      } catch {return Object.freeze({evidenceId:randomUUID(),source:'synthetic',state:'unknown',remaining:0,finalReceiptIssuable:false});}
    },
    restoreGate(households) {
      try {if(!Array.isArray(households)||households.length>1000) deny();
        const knownFenced = households.some(hh=>fenced(hh));
        // Missing tombstones cannot be disproved from a restored/local filesystem.
        // Never authorize serving without independent complete-ledger attestation.
        return Object.freeze({activationAllowed:false,knownFenced,independentLedgerVerified:false,providerAndBackupProof:false});
      } catch {return Object.freeze({activationAllowed:false,providerAndBackupProof:false});}
    },
  });
}
