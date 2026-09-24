import { assertLocalAccountMount } from "@/server/auth/local-account-mount";
import type { Metadata } from "next";
import { SecurityPanel } from "@/components/settings/security-panel";
export const metadata: Metadata = { title: "Account security" };
export default function AccountSecurityPage() {
 let available=false;try{assertLocalAccountMount(process.env);available=true;}catch{/* Hosted activation remains closed. */}
 return <main className="mx-auto max-w-xl p-6">{available?<SecurityPanel/>:<><h1>Account security unavailable</h1><p>This account-security flow is not enabled on this deployment.</p><a href="/sign-in">Return to sign in</a></>}</main>;
}
export const dynamic="force-dynamic";
