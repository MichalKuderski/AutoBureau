import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Start tracking your household's renewals, deadlines, and documents.",
};

export default function SignUpPage() {
  return <SignUpForm />;
}
