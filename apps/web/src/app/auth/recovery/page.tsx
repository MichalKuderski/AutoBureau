import type { Metadata } from "next";
import { accountSecurityAvailable } from "@/server/auth/account-mount";
import { RecoveryForm } from "./recovery-form";

// The one-use token hash is in this page's URL: never send it onward as a Referer.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const available = accountSecurityAvailable(process.env);
  const params = await searchParams, raw = params.token_hash, type = params.type;
  const tokenHash = typeof raw === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(raw) && type === "recovery" ? raw : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <RecoveryForm available={available} tokenHash={tokenHash} />
    </main>
  );
}
export const dynamic = "force-dynamic";
