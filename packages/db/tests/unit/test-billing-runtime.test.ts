import {afterEach,expect,it,vi} from "vitest";
vi.mock("../../src/scoped.js",()=>({createDatabase:vi.fn(()=>({synthetic:true}))}));
import {createLocalTestBillingDatabase,billingWorkTable} from "../../src/test-billing-runtime.js";
const local="postgresql://app_billing_test:synthetic@127.0.0.1:55541/pellum_fixture";
afterEach(()=>vi.unstubAllEnvs());
it("accepts only an explicit synthetic local dedicated-role connection",()=>expect(createLocalTestBillingDatabase(local)).toEqual({synthetic:true}));
it.each([local.replace("127.0.0.1","db.example.test"),local.replace("127.0.0.1","localhost"),local.replace("app_billing_test","app_user"),local.replace("app_billing_test","app_job_worker"),local.replace("app_billing_test","autobureau"),local.replace("pellum_fixture","postgres"),local+"?options=-c%20role%3Dautobureau",local+"#ignored"])("refuses nonlocal/wrong-role or overridden connection %s",url=>expect(()=>createLocalTestBillingDatabase(url)).toThrow("Local TEST billing unavailable"));
it.each(["VERCEL","AWS_EXECUTION_ENV","NODE_ENV"])("refuses hosted runtime marker %s",key=>{vi.stubEnv(key,key==="NODE_ENV"?"production":"present");expect(()=>createLocalTestBillingDatabase(local)).toThrow();});
it("never interpolates caller-selected billing table names",()=>expect(()=>billingWorkTable("notices; SELECT secrets" as "notice")).toThrow());

// ADR-020 hosted amendment: the billing runtime's own connection, only on a hosted billing build.
import {createHostedTestBillingDatabase} from "../../src/test-billing-runtime.js";
const hostedEnv={VERCEL:"1",NODE_ENV:"production",BILLING_RUNTIME:"stripe-test"};
const pooled="postgresql://app_billing_test.abcdefghijklmnopqrst:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true";
it("hosted: accepts only the dedicated billing login (pooler-suffixed or not) on a hosted billing build",()=>{
 expect(createHostedTestBillingDatabase(pooled,hostedEnv)).toEqual({synthetic:true});
 expect(createHostedTestBillingDatabase("postgresql://app_billing_test:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",hostedEnv)).toEqual({synthetic:true});
});
it.each([["app_user","postgresql://app_user:pw@db.example.test:5432/postgres"],["postgres","postgresql://postgres:pw@db.example.test:5432/postgres"],
 ["a lookalike role","postgresql://app_billing_test_x:pw@db.example.test:5432/postgres"],["a lookalike suffix","postgresql://app_billing_test.x:pw@db.example.test:5432/postgres"],
 ["no password","postgresql://app_billing_test@db.example.test:5432/postgres"],["loopback","postgresql://app_billing_test:pw@127.0.0.1:5432/postgres"],
 ["another database","postgresql://app_billing_test:pw@db.example.test:5432/other"],["not a URL","app_billing_test"]])("hosted: refuses %s",(_,url)=>expect(()=>createHostedTestBillingDatabase(url,hostedEnv)).toThrow("Hosted TEST billing unavailable"));
it.each([{VERCEL:undefined},{NODE_ENV:"test"},{BILLING_RUNTIME:undefined}])("hosted: refuses outside the hosted billing build %o",change=>
 expect(()=>createHostedTestBillingDatabase(pooled,{...hostedEnv,...change})).toThrow("Hosted TEST billing unavailable"));
