import { BasesWorkspace } from "../_components/workspace/bases-workspace";
import { requireAuth } from "~/lib/auth-guard";

export default async function BasesPage() {
  const { userName, userEmail } = await requireAuth();

  return <BasesWorkspace userName={userName} userEmail={userEmail} />;
}
