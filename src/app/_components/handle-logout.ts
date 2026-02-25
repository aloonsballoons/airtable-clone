"use client";

import { authClient } from "~/server/better-auth/client";

export async function handleLogout() {
  await authClient.signOut();
  window.location.href = "/";
}
