import type { Metadata } from "next";
import { assertLocalAccountMount } from "@/server/auth/local-account-mount";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ForgotPasswordPage() {
  // Hosted activation stays closed: only the loopback-only synthetic mount enables the form.
  let available = false;
  try { assertLocalAccountMount(process.env); available = true; } catch { /* unavailable */ }
  return <ForgotPasswordForm available={available} />;
}
export const dynamic = "force-dynamic";
