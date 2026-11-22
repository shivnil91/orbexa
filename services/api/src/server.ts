import { createServer } from "node:http";
import { acceptFeedback } from "./feedback-http.ts";
import { healthBody } from "./health.ts";
import { assertNoLiveStripeKey } from "./payments/guard.ts";
import { route } from "./routes.ts";
import { hospitalBedSummary } from "./slice.ts";

assertNoLiveStripeKey(process.env);

const port = Number(process.env.PORT ?? 43124);
const env = process.env.ORBEXA_ENV;
const server = createServer((request, response) => {
  const selected = route(request.method, request.url, env);
  if (selected === "health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(healthBody()));
    return;
  }
  if (selected === "demo") {
    void hospitalBedSummary()
      .then((summary) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(summary));
      })
      .catch((error: unknown) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "slice failed" }));
      });
    return;
  }
  if (selected === "feedback") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: unknown = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "feedback" }));
        return;
      }
      const decision = acceptFeedback(body);
      if (!decision.ok) {
        response.writeHead(decision.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: decision.error, trained: false }));
        return;
      }
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true, trained: false }));
    });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`orbexa-api listening on ${port}`);
});
