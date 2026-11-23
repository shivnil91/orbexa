import { readDb, updateDb } from "./demo-store.ts";

export type ClientDoc = { id: string; name: string; text: string };
export type ClientMemory = { at: string; summary: string };

export type ClientWorkspace = {
  clientId: string;
  sellerId: string;
  answers: Record<string, string>;
  docs: ClientDoc[];
  memory: ClientMemory[];
};

export async function readClient(sellerId: string, clientId: string): Promise<ClientWorkspace | null> {
  const db = await readDb();
  return (db.clients ?? []).find((item) => item.sellerId === sellerId && item.clientId === clientId) ?? null;
}

/** Opens this seller's workspace for the client. A client id owned by another seller is refused. */
export async function openClient(sellerId: string, clientId: string): Promise<{ ok: true; workspace: ClientWorkspace } | { ok: false; error: "isolation" }> {
  if (!sellerId || !clientId) return { ok: false, error: "isolation" };
  return updateDb((db) => {
    db.clients = db.clients ?? [];
    const existing = db.clients.find((item) => item.clientId === clientId && item.sellerId === sellerId);
    if (existing) return { ok: true as const, workspace: existing };
    const created: ClientWorkspace = { clientId, sellerId, answers: {}, docs: [], memory: [] };
    db.clients.push(created);
    return { ok: true as const, workspace: created };
  });
}

export async function rememberClient(sellerId: string, clientId: string, summary: string, answers: Record<string, string>): Promise<void> {
  const note = summary.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!note) return;
  await updateDb((db) => {
    const workspace = (db.clients ?? []).find((item) => item.sellerId === sellerId && item.clientId === clientId);
    if (!workspace) return;
    workspace.answers = { ...workspace.answers, ...answers };
    workspace.memory = workspace.memory.concat({ at: new Date().toISOString(), summary: note }).slice(-20);
  });
}

export async function addClientDoc(sellerId: string, clientId: string, doc: ClientDoc): Promise<{ ok: true } | { ok: false; error: "isolation" }> {
  const opened = await openClient(sellerId, clientId);
  if (!opened.ok) return opened;
  await updateDb((db) => {
    const workspace = (db.clients ?? []).find((item) => item.sellerId === sellerId && item.clientId === clientId);
    if (!workspace) return;
    workspace.docs = workspace.docs.filter((item) => item.id !== doc.id).concat(doc).slice(-20);
  });
  return { ok: true };
}
