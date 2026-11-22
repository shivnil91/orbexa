import { readJob } from "@/lib/jobs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const current = await readJob(id);
  if (!current) {
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
