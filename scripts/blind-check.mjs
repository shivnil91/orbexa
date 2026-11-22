import path from "node:path";
import { loadPersonaImages } from "./blind-images.mjs";

const shots = path.join(process.cwd(), "docs/gtm/round-4");
const personas = [
  { id: "maya", goal: "Maya owns a bakery. She wants a calm reply she can send to a catering client, and she will pay about $15 if the price and a sample are obvious." },
  { id: "derek", goal: "Derek manages operations. He wants a checklist a teammate can follow, and he will pay about $25 if the price and a sample are obvious." },
  { id: "priya", goal: "Priya is a freelancer. She wants a vague client request turned into scope, assumptions, and what is out of scope, and she will pay about $30 if the price and a sample are obvious." },
  { id: "helen", goal: "Helen is a retired engineer. She wants to publish a drawing check from what she is good at, see what a buyer would get, and know what she keeps." },
  { id: "andre", goal: "Andre is a bookkeeper. He wants to publish a monthly close checklist from what he is good at, see what a buyer would get, and know what he keeps." },
  { id: "luis", goal: "Luis drives and coaches youth soccer. He wants to publish a one-hour practice plan from that skill, see what a buyer would get, and know what he keeps." },
];

const anthropic = (process.env.ANTHROPIC_API_KEY ?? "").trim();
const openai = (process.env.OPENAI_API_KEY ?? "").trim();
const key = anthropic.length >= 20 && !anthropic.includes("sk_live_") ? { provider: "anthropic", value: anthropic } : openai.length >= 20 && !openai.includes("sk_live_") ? { provider: "openai", value: openai } : null;

if (!key) {
  console.log("blind check not run: no model key");
  process.exit(0);
}

const prompt = [
  "You are a person seeing this product for the first time. You do not know what the designer intended.",
  "From the screenshots and the goal only, answer in JSON with keys: thinks, wouldClick, wouldPayOrPublish, why.",
  "thinks: one sentence on what the product does.",
  "wouldClick: the exact words you would click or type.",
  "wouldPayOrPublish: yes or no.",
  "why: one sentence.",
].join(" ");

const answers = [];
for (const persona of personas) {
  const images = await loadPersonaImages(shots, persona.id);
  const content = [{ type: "text", text: `${prompt}\n\nGoal: ${persona.goal}` }];
  for (const image of images) {
    content.push({ type: "image", media_type: image.mediaType, data: image.data });
  }
  const text = key.provider === "anthropic" ? await askAnthropic(key.value, content) : await askOpenAI(key.value, content);
  answers.push({ persona: persona.id, text });
  console.log(`\n## ${persona.id}\n${text}`);
}

const refused = answers.filter((item) => /"wouldPayOrPublish"\s*:\s*"no"/i.test(item.text));
if (refused.length > 0) {
  console.error(`blind check: ${refused.map((item) => item.persona).join(", ")} said no`);
  process.exit(1);
}

async function askAnthropic(apiKey, content) {
  const blocks = content.map((block) => block.type === "text"
    ? { type: "text", text: block.text }
    : { type: "image", source: { type: "base64", media_type: block.media_type, data: block.data } });
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ORBEXA_MODEL?.trim() || "claude-sonnet-5-5", max_tokens: 400, messages: [{ role: "user", content: blocks }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`anthropic ${response.status}`);
  }
  const body = await response.json();
  return (body.content ?? []).map((block) => block.text ?? "").join("\n");
}

async function askOpenAI(apiKey, content) {
  const parts = [{ type: "text", text: content[0].text }];
  for (const block of content) {
    if (block.type === "image") {
      parts.push({ type: "image_url", image_url: { url: `data:${block.media_type};base64,${block.data}` } });
    }
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 400, messages: [{ role: "user", content: parts }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`openai ${response.status}`);
  }
  const body = await response.json();
  return body.choices?.[0]?.message?.content ?? "";
}
