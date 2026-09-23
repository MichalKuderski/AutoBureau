import {afterEach,expect,it,vi} from "vitest";
vi.mock("../../src/scoped.js",()=>({createDatabase:vi.fn(()=>({synthetic:true}))}));
import {createLocalTestBillingDatabase,billingWorkTable} from "../../src/test-billing-runtime.js";
const local="postgresql://app_billing_test:synthetic@127.0.0.1:55541/pellum_fixture";
afterEach(()=>vi.unstubAllEnvs());
it("accepts only an explicit synthetic local dedicated-role connection",()=>expect(createLocalTestBillingDatabase(local)).toEqual({synthetic:true}));
it.each([local.replace("127.0.0.1","db.example.test"),local.replace("127.0.0.1","localhost"),local.replace("app_billing_test","app_user"),local.replace("app_billing_test","app_job_worker"),local.replace("app_billing_test","autobureau"),local.replace("pellum_fixture","postgres"),local+"?options=-c%20role%3Dautobureau",local+"#ignored"])("refuses nonlocal/wrong-role or overridden connection %s",url=>expect(()=>createLocalTestBillingDatabase(url)).toThrow("Local TEST billing unavailable"));
it.each(["VERCEL","AWS_EXECUTION_ENV","NODE_ENV"])("refuses hosted runtime marker %s",key=>{vi.stubEnv(key,key==="NODE_ENV"?"production":"present");expect(()=>createLocalTestBillingDatabase(local)).toThrow();});
it("never interpolates caller-selected billing table names",()=>expect(()=>billingWorkTable("notices; SELECT secrets" as "notice")).toThrow());
