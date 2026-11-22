import { createServer } from "node:http";
import { healthBody } from "./health.ts";
import { route } from "./routes.ts";
import { hospitalBedSummary } from "./slice.ts";

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
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`orbexa-api listening on ${port}`);
});
