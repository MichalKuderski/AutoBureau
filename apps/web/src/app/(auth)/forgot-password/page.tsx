import type { Metadata } from "next";
import { accountSecurityAvailable } from "@/server/auth/account-mount";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ForgotPasswordPage() {
  // Enabled on the synthetic loopback mount and on hosted runtimes (account-mount.ts); the kill switch closes it.
  const available = accountSecurityAvailable(process.env);
  return <ForgotPasswordForm available={available} />;
}
export const dynamic = "force-dynamic";
