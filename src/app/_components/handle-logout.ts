"use client";

import { authClient } from "~/server/better-auth/client";

export async function handleLogout(refreshFn: () => void) {
  await authClient.signOut();
  refreshFn();
}
