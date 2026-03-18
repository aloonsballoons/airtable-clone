import { redirect } from "next/navigation";
import { getSession } from "~/server/better-auth/server";

/**
 * Server-side auth guard for page components.
 * Returns the session with user info, or redirects to "/" if unauthenticated.
 */
export async function requireAuth() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/");
  }

  return {
    session,
    userName: session.user.name ?? session.user.email ?? "",
    userEmail: session.user.email ?? "",
  };
}
