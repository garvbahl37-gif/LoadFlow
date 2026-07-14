import { redirect } from "next/navigation";
import { getSession, homePathFor } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  // redirect() throws — never wrap it in try/catch, never `return redirect(...)`.
  redirect(session ? homePathFor(session.orgType) : "/login");
}
