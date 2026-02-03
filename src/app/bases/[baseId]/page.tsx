import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { TableWorkspace } from "../../_components/table-workspace";
import { auth } from "~/server/better-auth";

type BasePageProps = {
  params: Promise<{
    baseId: string;
  }>;
};

export default async function BasePage({ params }: BasePageProps) {
  const { baseId } = await params;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session?.user) {
    redirect("/");
  }

  return <TableWorkspace baseId={baseId} />;
}
