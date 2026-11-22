import { readJob, revealNext } from "@/lib/jobs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        const current = await readJob(id);
        if (!current) {
          controller.close();
          return false;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ cursor: current.cursor, status: current.status })}\n\n`));
        return current.status === "queued" || current.status === "running";
      };
      let open = await send();
      while (open) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await revealNext(id);
        open = await send();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}
