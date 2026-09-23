import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,it,expect } from "vitest";
import { createDatabase,type Database } from "@autobureau/db";
import { APP_URL,adminClient,assertExpectedServer,grantAppUserLogin } from "@/test/integration/database";
import { createDatabaseExportPorts } from "./export-ports";
import { bucketOf } from "../http/rate-limit";
let db:Database,admin:ReturnType<typeof adminClient>;const user=randomUUID(),ip="203.0.113.239";
const request=()=>new Request("https://pellum.invalid/v1/exports",{method:"POST",headers:{"x-forwarded-for":ip}});
const verifier={verify:async()=>{throw new Error("not needed");}},provider={factors:async()=>{throw new Error("not needed");}};
beforeAll(async()=>{await assertExpectedServer();await grantAppUserLogin();admin=adminClient();db=createDatabase(APP_URL());},120000);
afterAll(async()=>{await admin.authRateLimit.deleteMany({where:{bucket:{in:[bucketOf("export.identifier",user),bucketOf("export.ip",ip)]}}});await admin.$disconnect();await db.disconnect();});
it("shares an atomic limit across independently composed controllers and concurrent attempts",async()=>{
 const outcomes=await Promise.all(Array.from({length:24},()=>createDatabaseExportPorts(db,verifier,provider).limit(request(),user)));
 expect(outcomes.filter(Boolean)).toHaveLength(20);expect(outcomes.filter(v=>!v)).toHaveLength(4);
 expect(await createDatabaseExportPorts(db,verifier,provider).limit(request(),user)).toBe(false);
});
it("missing ingress address fails closed",async()=>{
 await expect(createDatabaseExportPorts(db,verifier,provider).limit(new Request("https://pellum.invalid"),user)).rejects.toThrow("Export unavailable");
});
it("counter outage fails closed",async()=>{
 const broken={withGlobalTable:async()=>{throw new Error("synthetic outage");}} as unknown as Database;
 await expect(createDatabaseExportPorts(broken,verifier,provider).limit(request(),user)).rejects.toThrow("Export unavailable");
});
