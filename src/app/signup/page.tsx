import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { Button } from "@/components/ui";
import { getSession, homePathFor } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create an organization — LoadFlow",
};

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect(homePathFor(session.orgType));

  return (
    <AuthShell
      aside={
        <Link href="/login">
          <Button size="sm" variant="secondary">
            Sign in
          </Button>
        </Link>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
