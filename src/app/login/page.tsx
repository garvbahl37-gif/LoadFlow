import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { safeNext } from "@/components/auth/api-error";
import { AuthShell, ProductPitch } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getSession, homePathFor } from "@/lib/auth/session";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in — LoadFlow",
};

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNext(typeof raw === "string" ? raw : undefined);

  const session = await getSession();
  // Already signed in — don't show a sign-in form. redirect() throws; never wrap it.
  if (session) redirect(next ?? homePathFor(session.orgType));

  return (
    <AuthShell
      aside={
        <Link href="/signup">
          <Button size="sm" variant="secondary">
            Create an organization
          </Button>
        </Link>
      }
    >
      <div className="mb-9 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-ink sm:text-[28px]">
          The compliance gate that won&apos;t let you dispatch to an uninsured carrier.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          LoadFlow runs the broker&rarr;carrier&rarr;shipper lifecycle behind a real
          permission engine. Post a load, vet a carrier, confirm a rate, move the
          freight &mdash; and get stopped, loudly, when the carrier&apos;s paperwork
          isn&apos;t good.
        </p>
      </div>

      <div className="mb-10 border-y border-line py-6">
        <ProductPitch />
      </div>

      <LoginForm next={next} />
    </AuthShell>
  );
}
