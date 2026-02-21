import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BasesWorkspace } from "../_components/bases-workspace";
import { auth } from "~/server/better-auth";

export default async function BasesPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session?.user) {
    redirect("/");
  }

  const userName = session.user.name ?? session.user.email ?? "";
  const userEmail = session.user.email ?? "";

  return <BasesWorkspace userName={userName} userEmail={userEmail} />;
}
