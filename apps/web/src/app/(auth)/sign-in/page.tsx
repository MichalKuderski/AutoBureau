import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to AutoBureau.",
};

export default function SignInPage() {
  return <SignInForm />;
}
