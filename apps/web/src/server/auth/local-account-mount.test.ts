// @vitest-environment node
import { it, expect } from "vitest";
import { assertLocalAccountMount } from "./local-account-mount";
const valid={NODE_ENV:"test",LOCAL_ACCOUNT_ROUTES:"synthetic-only",AUTH_API_URL:"http://127.0.0.1:4555",AUTH_JWKS_URL:"http://127.0.0.1:4555/jwks",APP_ORIGIN:"http://127.0.0.1:4317",DATABASE_URL:"postgresql://app_user:synthetic@127.0.0.1:55540/pellum_fixture"};
it("admits explicitly configured synthetic loopback only",()=>expect(()=>assertLocalAccountMount(valid)).not.toThrow());
it("admits a loopback TLS browser origin, which Secure cookies need in WebKit",()=>expect(()=>assertLocalAccountMount({...valid,APP_ORIGIN:"https://127.0.0.1:4317"})).not.toThrow());
it.each([
 {NODE_ENV:"production"},{VERCEL:"1"},{AWS_EXECUTION_ENV:"AWS_Lambda"},{LOCAL_ACCOUNT_ROUTES:undefined},
 {AUTH_API_URL:"https://staging.supabase.co/auth/v1"},{AUTH_API_URL:"http://127.0.0.1.attacker.test"},
 {AUTH_JWKS_URL:"https://staging.supabase.co/jwks"},{APP_ORIGIN:"https://autobureau-staging.vercel.app"},
 {DATABASE_URL:"postgresql://postgres@127.0.0.1:55540/pellum_fixture"},{DATABASE_URL:"postgresql://app_user@db.example.test/pellum_fixture"},
 {DATABASE_URL:"postgresql://app_user@127.0.0.1:5432/postgres"},
 {APP_ORIGIN:"https://localhost:4317"},{APP_ORIGIN:"ftp://127.0.0.1:4317"},{APP_ORIGIN:"https://127.0.0.1.attacker.test"},{AUTH_API_URL:"https://127.0.0.1:4555"},
])("refuses any hosted/privileged/ambiguous mount configuration %s",patch=>expect(()=>assertLocalAccountMount({...valid,...patch})).toThrow());
