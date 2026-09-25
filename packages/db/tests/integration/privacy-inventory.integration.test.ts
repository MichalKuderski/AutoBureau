import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll,afterAll,it,expect } from "vitest";
import { Database } from "../../src/scoped.js";
import { runAsUser,runAsSystem } from "../../src/audit.js";
import { inventoryLocalDeletionPage,reconcileLocalDeletionInventory,reconcileDeletionAttemptsPage } from "../../src/privacy-inventory.js";
import { requestHouseholdDeletion,fenceHouseholdDeletion,appendDeletionManifest,readDeletionProgress,sealDeletionManifest,claimDeletionAttempt } from "../../src/deletion-journal.js";
import { DELETION_COMPONENTS } from "@autobureau/contracts";
import { ADMIN_URL,APP_URL,adminClient,bootstrapDatabase,grantAppUserLogin } from "./setup.js";
let admin:PrismaClient, app:PrismaClient, retention:PrismaClient, verifier:PrismaClient;
let appDb:Database,retentionDb:Database,verifyDb:Database;
const owner=randomUUID(), households:string[]=[];
beforeAll(async()=>{
 await bootstrapDatabase();await grantAppUserLogin();admin=adminClient();app=new PrismaClient({datasourceUrl:APP_URL});appDb=new Database(app);
 const clients=[];
 for(const role of ["app_retention_worker","app_deletion_verifier"]){
  await admin.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD 'privacy_local_only'`);
  const u=new URL(ADMIN_URL);u.username=role;u.password="privacy_local_only";clients.push(new PrismaClient({datasourceUrl:u.toString()}));
 }
 [retention,verifier]=clients as [PrismaClient,PrismaClient];retentionDb=new Database(retention);verifyDb=new Database(verifier);
 await admin.user.create({data:{id:owner,email:`${owner}@example.test`}});
},120_000);
afterAll(async()=>{
 if(admin){const where={householdId:{in:households}};
 await admin.deletionObservation.deleteMany({where});await admin.deletionAttempt.deleteMany({where});await admin.deletionResource.deleteMany({where});await admin.householdDeletion.deleteMany({where});
 await admin.accountSecurityChallenge.deleteMany({where});
 await admin.documentProcessing.deleteMany({where});await admin.documentCustody.deleteMany({where});await admin.documentScan.deleteMany({where});
 await admin.localExportArtifact.deleteMany({where:{householdId:{in:households}}});
 await admin.stripeTestState.deleteMany({where});await admin.stripeTestNotice.deleteMany({where});await admin.stripeTestBinding.deleteMany({where});
 await admin.household.deleteMany({where:{id:{in:households}}});await admin.auditLog.deleteMany({where});await admin.user.delete({where:{id:owner}});
 for(const role of ["app_retention_worker","app_deletion_verifier"])await admin.$executeRawUnsafe(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL`);}
 await Promise.all([admin,app,retention,verifier].map(c=>c?.$disconnect()));
});
async function fixture(count=0){
 const hh=randomUUID();households.push(hh);
 await admin.household.create({data:{id:hh,name:"PUBLIC privacy fixture",createdBy:owner}});await admin.householdUser.create({data:{householdId:hh,userId:owner,role:"owner"}});
 if(count)await admin.item.createMany({data:Array.from({length:count},()=>({householdId:hh,name:"PUBLIC",kind:"other" as const}))});
 const id=await runAsUser(owner,()=>requestHouseholdDeletion(appDb,hh,"DELETE HOUSEHOLD"));
 await admin.$executeRaw`UPDATE household_deletions SET requested_at=clock_timestamp()-interval '20 days',undo_until=clock_timestamp()-interval '6 days' WHERE id=${id}::uuid`;
 await fenceHouseholdDeletion(retentionDb,hh,id);
 await admin.$executeRaw`UPDATE household_deletions SET fenced_at=clock_timestamp()-interval '16 minutes',settle_until=clock_timestamp()-interval '1 minute' WHERE id=${id}::uuid`;
 return {hh,id};
}
it("inventories 1,005 records in bounded durable pages and independently reconciles",async()=>{
 const f=await fixture(1005),other=await fixture(2);const sizes=[];
 for(let n=0;n<12;n++){const page=await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items");sizes.push(page.recorded);if(!page.more)break;}
 expect(sizes).toEqual([...Array(10).fill(100),5]);
 expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")).toMatchObject({recorded:0,more:false,inventoryComplete:false});
 expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"items")).toMatchObject({sourceCount:1005,manifested:1005,missing:0,extra:0,localSourceMatches:true,inventoryComplete:false});
 expect(await reconcileLocalDeletionInventory(verifyDb,other.hh,other.id,"items")).toMatchObject({sourceCount:2,manifested:0,missing:2,localSourceMatches:false});
 expect(await retention.deletionResource.count()).toBe(0);
});
it("resumes after a lost page response; concurrent calls never duplicate the manifest",async()=>{
 const f=await fixture(205);
 const results=await Promise.all([inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items"),inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")]);
 expect(results.map(r=>r.recorded)).toEqual([100,100]);
 expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")).toMatchObject({recorded:5});
 expect(await admin.deletionResource.count({where:{deletionId:f.id}})).toBe(205);
});
it("finds missing/extra inventory after source drift instead of trusting the cursor",async()=>{
 const f=await fixture(3);await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items");
 const row=await admin.item.findFirstOrThrow({where:{householdId:f.hh}});await admin.item.delete({where:{id:row.id}});
 await admin.item.create({data:{id:"00000000-0000-4000-8000-000000000001",householdId:f.hh,kind:"other",name:"PUBLIC"}});
 expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")).toMatchObject({recorded:0});
 expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"items")).toMatchObject({missing:1,extra:1,localSourceMatches:false});
});
it("distinguishes identical row UUIDs from different source tables",async()=>{
 const f=await fixture(1);const item=await admin.item.findFirstOrThrow({where:{householdId:f.hh}});
 await admin.obligation.create({data:{id:item.id,householdId:f.hh,kind:"custom",title:"PUBLIC",source:"user",dueAt:new Date()}});
 await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items");await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"obligations");
 const rows=await admin.deletionResource.findMany({where:{deletionId:f.id}});expect(new Set(rows.map(r=>r.resourceRef)).size).toBe(2);
});
it("refuses an app-role inventory write, cross-household request and unknown source",async()=>{
 const a=await fixture(1),b=await fixture(1);
 await expect(inventoryLocalDeletionPage(appDb,a.hh,a.id,"items")).rejects.toThrow();
 await expect(inventoryLocalDeletionPage(retentionDb,b.hh,a.id,"items")).rejects.toThrow();
 // Runtime callers are not protected by TypeScript alone.
 await expect(inventoryLocalDeletionPage(retentionDb,a.hh,a.id,"item_secrets; SELECT ciphertext" as never)).rejects.toThrow();
 await expect(retentionDb.withHousehold(a.hh,tx=>tx.$queryRaw`SELECT ciphertext FROM item_secrets`)).rejects.toThrow();
});
it("requires settlement and refuses inventory after sealing",async()=>{
 const f=await fixture(1);await admin.householdDeletion.update({where:{id:f.id},data:{settleUntil:new Date(Date.now()+60000)}});
 await expect(inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")).rejects.toThrow();
 await admin.householdDeletion.update({where:{id:f.id},data:{settleUntil:new Date(0)}});
 await appendDeletionManifest(retentionDb,f.hh,f.id,DELETION_COMPONENTS.map(component=>({component,resourceRef:randomUUID(),inventoryCount:0})));
 await sealDeletionManifest(retentionDb,f.hh,f.id);
 await expect(inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items")).rejects.toThrow();
});
it("rejects duplicate entries in one submitted page but permits exact page replay",async()=>{
 const f=await fixture();const value={component:"documents",resourceRef:randomUUID(),inventoryCount:0};
 await expect(appendDeletionManifest(retentionDb,f.hh,f.id,[value,value])).rejects.toThrow("invalid");
 await appendDeletionManifest(retentionDb,f.hh,f.id,[value]);await appendDeletionManifest(retentionDb,f.hh,f.id,[value]);
 expect(await admin.deletionResource.count({where:{deletionId:f.id}})).toBe(1);
});
it("provides a scope-bound cursor for progress beyond the first 250 resources",async()=>{
 const f=await fixture(505);for(let i=0;i<6;i++)await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items");
 const first=(await readDeletionProgress(appDb,f.hh,f.id))!;expect(first.resources).toHaveLength(250);expect(first.nextCursor).not.toBeNull();
 const second=(await readDeletionProgress(appDb,f.hh,f.id,first.nextCursor!))!;const third=(await readDeletionProgress(appDb,f.hh,f.id,second.nextCursor!))!;
 expect(second.resources).toHaveLength(250);expect(third.resources).toHaveLength(5);expect(third.nextCursor).toBeNull();
 expect(new Set([...first.resources,...second.resources,...third.resources].map(r=>r.id)).size).toBe(505);
 await expect(readDeletionProgress(appDb,randomUUID(),f.id,first.nextCursor!)).rejects.toThrow("invalid");
});
it("reconciles expired/in-flight attempts without mistaking them for erasure",async()=>{
 const f=await fixture();await appendDeletionManifest(retentionDb,f.hh,f.id,DELETION_COMPONENTS.map(component=>({component,resourceRef:randomUUID(),inventoryCount:0})));await sealDeletionManifest(retentionDb,f.hh,f.id);
 const r=await admin.deletionResource.findFirstOrThrow({where:{deletionId:f.id}});const claim=(await claimDeletionAttempt(retentionDb,f.hh,r.id))!;
 expect((await reconcileDeletionAttemptsPage(verifyDb,f.hh,f.id)).resources.find(x=>x.id===r.id)?.status).toBe("in-flight");
 await admin.deletionAttempt.update({where:{id:claim.id},data:{leaseUntil:new Date(0)}});
 expect((await reconcileDeletionAttemptsPage(verifyDb,f.hh,f.id)).resources.find(x=>x.id===r.id)?.status).toBe("lease-expired");
 expect(await readDeletionProgress(appDb,f.hh,f.id)).toMatchObject({finalReceiptIssuable:false});
});

it("rejects incomplete source/key pairs at the database boundary",async()=>{
 const f=await fixture();
 for(const pair of [[null,"abc"],["items",null]] as const){
  await expect(runAsSystem("PUBLIC constraint test",()=>retentionDb.withHousehold(f.hh,tx=>tx.$executeRaw`INSERT INTO deletion_resources(deletion_id,household_id,component,resource_ref,inventory_count,inventory_source,source_key) VALUES(${f.id}::uuid,${f.hh}::uuid,'derived-records',${randomUUID()}::uuid,1,${pair[0]},${pair[1]})`))).rejects.toThrow(/inventory_source_pair/);
 }
});

it("independently detects a forged source-to-resource binding",async()=>{
 const f=await fixture(1);await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"items");
 await admin.deletionResource.updateMany({where:{deletionId:f.id},data:{resourceRef:randomUUID()}});
 expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"items")).toMatchObject({missing:0,extra:0,invalid:1,localSourceMatches:false});
});

it("includes challenge evidence without granting retention/verifier session or factor visibility",async()=>{
 const f=await fixture(), g=await fixture();
 await admin.accountSecurityChallenge.createMany({data:[f.hh,g.hh].map(householdId=>({householdId,userId:owner,sessionId:randomUUID(),factorId:randomUUID(),challengeId:randomUUID(),expiresAt:new Date(Date.now()+120000)}))});
 expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"auth-challenges")).toMatchObject({missing:1,localSourceMatches:false});
 expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"auth-challenges")).toMatchObject({recorded:1,more:false});
 expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"auth-challenges")).toMatchObject({sourceCount:1,manifested:1,localSourceMatches:true,finalReceiptIssuable:false});
 for(const db of [retentionDb,verifyDb]){
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT session_id,factor_id,challenge_id FROM account_security_challenges`)).rejects.toThrow();
  expect(await db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT id FROM account_security_challenges WHERE household_id=${g.hh}::uuid`)).toEqual([]);
 }
});

it("inventories TEST billing references without exposing provider IDs to privacy workers",async()=>{
 const f=await fixture();const suffix=randomUUID().replaceAll("-","");
 const b=await admin.stripeTestBinding.create({data:{householdId:f.hh,ownerId:owner,accountId:"acct_Synthetic",customerId:`cus_${suffix}`,subscriptionId:`sub_${suffix}`}});
 const n=await admin.stripeTestNotice.create({data:{householdId:f.hh,bindingId:b.id,accountId:b.accountId,eventId:`evt_${suffix}`,eventType:"invoice.paid",objectId:`in_${suffix}`,providerCreated:1n}});
 await admin.stripeTestState.create({data:{householdId:f.hh,bindingId:b.id,accountId:b.accountId,sourceNoticeId:n.id,sourceLeaseToken:randomUUID(),state:"inactive",plan:"monthly"}});
 for(const source of ["stripe-bindings","stripe-notices","stripe-states"] as const){
  expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,source)).toMatchObject({recorded:1});
  expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,source)).toMatchObject({sourceCount:1,manifested:1,localSourceMatches:true,finalReceiptIssuable:false});
 }
 for(const db of [retentionDb,verifyDb]){
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT customer_id FROM stripe_test_bindings`)).rejects.toThrow();
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT event_id FROM stripe_test_notices`)).rejects.toThrow();
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT source_lease_token FROM stripe_test_states`)).rejects.toThrow();
 }
});
it("inventories export journals without granting ciphertext digest or owner visibility",async()=>{
 const f=await fixture();await admin.localExportArtifact.create({data:{householdId:f.hh,requestId:randomUUID(),ownerId:owner,ciphertextDigest:"a".repeat(64),sizeBytes:123,snapshotAt:new Date(),expiresAt:new Date(Date.now()+3600000)}});
 try{
  expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,"export-artifacts")).toMatchObject({recorded:1});
  expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,"export-artifacts")).toMatchObject({sourceCount:1,localSourceMatches:true,finalReceiptIssuable:false});
  for(const db of [retentionDb,verifyDb])await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT ciphertext_digest,owner_id FROM local_export_artifacts`)).rejects.toThrow();
 }finally{await admin.localExportArtifact.deleteMany({where:{householdId:f.hh}});}
});
it("reconciles custody/work inventory without granting storage or lease visibility",async()=>{
 const f=await fixture(),g=await fixture();
 for(const hh of [f.hh,g.hh]){
  const doc=await admin.document.create({data:{householdId:hh,source:'upload',status:'queued',storagePath:'PUBLIC synthetic',mimeType:'application/pdf',sizeBytes:128,sha256:Buffer.alloc(32,1)}});
  const scan=await admin.documentScan.create({data:{householdId:hh,documentId:doc.id,sealId:randomUUID(),sha256:Buffer.alloc(32,1),sizeBytes:128,state:'clean'}});
  const custody=await admin.documentCustody.create({data:{householdId:hh,documentId:doc.id,scanId:scan.id,objectId:randomUUID(),sha256:Buffer.alloc(32,1),sizeBytes:128,state:'ready',reviewAt:new Date(Date.now()+86400000)}});
  await admin.documentProcessing.create({data:{householdId:hh,custodyId:custody.id}});
 }
 for(const source of ['custodies','processing'] as const){
  expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,source)).toMatchObject({missing:1,localSourceMatches:false});
  expect(await inventoryLocalDeletionPage(retentionDb,f.hh,f.id,source)).toMatchObject({recorded:1,inventoryComplete:false});
  expect(await reconcileLocalDeletionInventory(verifyDb,f.hh,f.id,source)).toMatchObject({sourceCount:1,manifested:1,localSourceMatches:true,finalReceiptIssuable:false});
 }
 for(const db of [retentionDb,verifyDb]){
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT object_id,sha256 FROM document_custodies`)).rejects.toThrow();
  await expect(db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT lease_token,result_ref FROM document_processing`)).rejects.toThrow();
  expect(await db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT id FROM document_custodies WHERE household_id=${g.hh}::uuid`)).toEqual([]);
  expect(await db.withHousehold(f.hh,tx=>tx.$queryRaw`SELECT id FROM document_processing WHERE household_id=${g.hh}::uuid`)).toEqual([]);
 }
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DELETION_INVENTORY_EXCLUSIONS, EXPORT_COVERAGE, NON_HOUSEHOLD_TABLES } from "../../src/privacy-coverage.js";
import { PRIVACY_INVENTORY_TABLES } from "../../src/privacy-inventory.js";
import { EXPORT_V3_CATEGORIES } from "@autobureau/contracts";
it("every household table has exactly one deletion answer and an export answer (completeness control)", async () => {
  const tables = (await admin.$queryRaw<Array<{ t: string }>>`SELECT c.relname AS t FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
    AND a.attname='household_id' AND NOT a.attisdropped WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY 1`).map(r => r.t);
  expect(tables.length).toBeGreaterThan(40);
  const inventoried = new Set(PRIVACY_INVENTORY_TABLES);
  const deletionGaps = tables.filter(t => inventoried.has(t) === (t in DELETION_INVENTORY_EXCLUSIONS));
  expect(deletionGaps).toEqual([]);
  expect(tables.filter(t => !/^(category|omitted):/.test(EXPORT_COVERAGE[t] ?? ""))).toEqual([]);
  // No stale answers for tables that no longer exist.
  expect(Object.keys({ ...DELETION_INVENTORY_EXCLUSIONS, ...EXPORT_COVERAGE }).filter(t => !tables.includes(t))).toEqual([]);
  const categories = new Set(Object.values(EXPORT_COVERAGE).filter(v => v.startsWith("category:")).map(v => v.slice(9)));
  expect([...categories].filter(c => !(EXPORT_V3_CATEGORIES as readonly string[]).includes(c))).toEqual([]);
  // An exported table must actually be read by the v3 snapshot statement.
  const src = readFileSync(resolve(__dirname, "../../src/privacy-export.ts"), "utf8");
  const v3 = src.slice(src.indexOf("export async function readOwnerExportSnapshotV3"));
  const read = new Set([...v3.slice(0, v3.indexOf("\nexport", 10)).matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_]+)/g)].map(m => m[1]));
  expect(Object.entries(EXPORT_COVERAGE).filter(([t, v]) => v.startsWith("category:") && !read.has(t)).map(([t]) => t)).toEqual([]);
});
it("every table without household_id has a reviewed classification, and household-via tables cascade and are inventoried", async () => {
  const rows = await admin.$queryRaw<Array<{ t: string }>>`SELECT c.relname AS t FROM pg_class c WHERE c.relnamespace='public'::regnamespace
    AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='household_id' AND NOT a.attisdropped) ORDER BY 1`;
  const tables = rows.map(r => r.t);
  expect(tables.filter(t => !/^(household-anchor|household-via:[a-z_]+|account-scope|global):/.test(NON_HOUSEHOLD_TABLES[t] ?? ""))).toEqual([]);
  expect(Object.keys(NON_HOUSEHOLD_TABLES).filter(t => !tables.includes(t))).toEqual([]);
  const inventoried = new Set(PRIVACY_INVENTORY_TABLES);
  for (const [table, answer] of Object.entries(NON_HOUSEHOLD_TABLES)) {
    const via = /^household-via:([a-z_]+):/.exec(answer)?.[1];
    if (!via) continue;
    const fk = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_constraint k
      WHERE k.contype='f' AND k.conrelid=${`public.${table}`}::regclass AND k.confrelid=${`public.${via}`}::regclass AND k.confdeltype='c'`;
    expect({ table, cascadesFromParent: Number(fk[0]!.n) > 0, inventoried: inventoried.has(table) }).toEqual({ table, cascadesFromParent: true, inventoried: true });
  }
});
it("the no-writer exception for inbound email stays true until intake gets deletion coverage", () => {
  const root = resolve(__dirname, "../../../..");
  const files = (dir: string): string[] => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(e =>
    e.name === "node_modules" || e.name === "dist" || e.name === ".next" ? [] : e.isDirectory() ? files(`${dir}/${e.name}`) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const writers = ["apps/web/src", "packages/db/src", "services", "scripts"].flatMap(files)
    .filter(f => !/\.test\.|privacy-coverage\.ts$/.test(f) && /inbound_emails|inboundEmail/.test(readFileSync(resolve(root, f), "utf8")));
  expect(writers).toEqual([]);
});
