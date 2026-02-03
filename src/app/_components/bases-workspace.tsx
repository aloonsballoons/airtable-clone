"use client";

import clsx from "clsx";
import { Inter } from "next/font/google";
import { useRouter } from "next/navigation";

import { authClient } from "~/server/better-auth/client";
import { api } from "~/trpc/react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["500"],
});

export function BasesWorkspace() {
  const router = useRouter();
  const utils = api.useUtils();

  const baseListQuery = api.base.list.useQuery();

  const createBase = api.base.create.useMutation({
    onSuccess: async () => {
      await utils.base.list.invalidate();
    },
  });

  const deleteBase = api.base.deleteBase.useMutation({
    onSuccess: async () => {
      await utils.base.list.invalidate();
    },
  });

  const handleCreateBase = () => {
    createBase.mutate({});
  };

  const handleOpenBase = (baseId: string) => {
    router.push(`/bases/${baseId}`);
  };

  const handleDeleteBase = (baseId: string) => {
    deleteBase.mutate({ baseId });
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.refresh();
  };

  const bases = baseListQuery.data ?? [];
  const baseCount = bases.length;

  return (
    <div className={clsx("min-h-screen bg-white", inter.className)}>
      <header className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-4">
        <div>
          <p className="text-[14px] font-medium text-[#0f172a]">Your Bases</p>
          <p className="text-[12px] text-[#64748b]">
            {baseCount} base{baseCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCreateBase}
            disabled={createBase.isPending}
            className="h-[32px] w-[275px] bg-[#156fe2] text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            Create
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[12px] font-medium text-[#0f172a] hover:border-[#94a3b8]"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="px-6 py-6">
        {baseListQuery.isLoading ? (
          <div className="rounded-[16px] border border-[#e2e8f0] bg-white px-6 py-8 text-[13px] text-[#64748b]">
            Loading bases...
          </div>
        ) : bases.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-10">
            <p className="text-[14px] font-medium text-[#0f172a]">
              No bases yet
            </p>
            <p className="mt-1 text-[12px] text-[#64748b]">
              Create your first base using the Create button above.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {bases.map((baseItem) => (
              <div
                key={baseItem.id}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-[#e2e8f0] bg-white px-4 py-3 text-left transition hover:border-[#94a3b8]"
              >
                <button
                  type="button"
                  onClick={() => handleOpenBase(baseItem.id)}
                  className="flex-1 text-left"
                >
                  <p className="text-[13px] font-medium text-[#0f172a]">
                    {baseItem.name}
                  </p>
                  <p className="text-[11px] text-[#64748b]">Open base</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteBase(baseItem.id)}
                  className="rounded-[8px] border border-[#e2e8f0] px-2 py-1 text-[11px] text-[#dc2626] hover:border-[#fca5a5]"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
