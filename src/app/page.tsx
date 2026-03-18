import { redirect } from "next/navigation";

import { LoginPage } from "./_components/workspace/login-page";
import { getSession } from "~/server/better-auth/server";

export default async function Home() {
  const session = await getSession();

  if (!session?.user) {
    return <LoginPage />;
  }

  redirect("/bases");
}
