import Link from "next/link";
import { Alert } from "@/components/ui/alert";

/** Never report an email as sent when no recovery endpoint exists. */
export function ForgotPasswordForm() {
  return (
    <>
      <h1 className="text-2xl leading-tight">Reset your password</h1>
      <Alert tone="info" title="Not available in this preview" className="mt-5">
        Password reset is still being implemented. No reset email has been sent.
        You can return to sign in and use the email-link option if you have access to your inbox.
      </Alert>
      <Link href="/sign-in" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </>
  );
}
