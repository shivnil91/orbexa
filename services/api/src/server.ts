import { createServer } from "node:http";
import { healthBody } from "./health.ts";

const port = Number(process.env.PORT ?? 43124);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(healthBody()));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`orbexa-api listening on ${port}`);
});
