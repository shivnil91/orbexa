import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations } from "./migrations.ts";

const requiredTables = [
  "processing_regions",
  "cell_identity",
  "currencies",
  "users",
  "orgs",
  "org_memberships",
  "expert_profiles",
  "compliance_screenings",
  "jurisdiction_restrictions",
  "agents",
  "agent_versions",
  "listing_tiers",
  "orders",
  "ledger_transactions",
  "ledger_entries",
  "jobs",
  "document_chunks",
  "chunk_embeddings",
  "draft_claims",
  "claim_citations",
  "memory_items",
  "memory_provenance",
  "memory_embeddings",
  "consent_grants",
  "llm_invocations",
  "llm_cache",
  "prompt_traces",
  "tool_calls",
  "audit_log",
  "job_messages",
  "job_ratings",
];

const forcedRls = [
  "documents",
  "document_chunks",
  "memory_items",
  "memory_provenance",
  "orders",
  "ledger_entries",
  "llm_cache",
  "prompt_traces",
  "job_messages",
];

test("migrations declare the foundation tables and do not enable checkout", async () => {
  const files = await loadMigrations();
  const sql = files.map((file) => file.sql).join("\n");
  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`));
  }
  for (const table of forcedRls) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.equal(sql.includes("checkout_enabled = true"), false);
  assert.equal(sql.includes("INSERT INTO jurisdiction_restrictions"), false);
  assert.equal(sql.includes("sk_live"), false);
  assert.match(sql, /SECURITY INVOKER/);
  for (const name of ["app.retrieve_chunks", "app.retrieve_memory"]) {
    const bodies = [
      ...sql.matchAll(
        new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replace(".", "\\.")}\\([\\s\\S]*?\\$\\$;`, "g"),
      ),
    ];
    assert.ok(bodies.length >= 1, name);
    for (const body of bodies) {
      assert.equal(body[0].includes("SECURITY DEFINER"), false, name);
      assert.match(body[0], /SECURITY INVOKER/);
    }
  }
});
