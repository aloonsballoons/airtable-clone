import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { TableWorkspace } from "../../_components/table-workspace";
import { auth } from "~/server/better-auth";
import { api, HydrateClient } from "~/trpc/server";

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

  const userName = session.user.name ?? session.user.email ?? "";
  const userEmail = session.user.email ?? "";

  // Prefetch base details on the server — data is dehydrated to the client
  // query cache, eliminating the initial client-side fetch round trip.
  const baseData = await api.base.get({ baseId });

  // Prefetch the first table's metadata in parallel so the client doesn't
  // need another round trip for column definitions and row count.
  const firstTable = baseData.tables[0];
  if (firstTable) {
    void api.base.getTableMeta.prefetch({ tableId: firstTable.id });
  }

  return (
    <HydrateClient>
      <TableWorkspace baseId={baseId} userName={userName} userEmail={userEmail} />
    </HydrateClient>
  );
}
