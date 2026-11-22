import { canReadJob } from "@/lib/job-access";
import { readJob } from "@/lib/jobs";
import { currentUser } from "@/server/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await currentUser();
  const current = await readJob(id);
  if (!current || !canReadJob(current.tenantId, user)) {
    return new Response("missing", { status: 404 });
  }
  const body = `data: ${JSON.stringify({ cursor: current.cursor, status: current.status })}\n\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
}
