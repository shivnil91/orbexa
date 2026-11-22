export type Health = {
  service: "orbexa-api";
  status: "ok";
};

export function healthBody(): Health {
  return { service: "orbexa-api", status: "ok" };
}
