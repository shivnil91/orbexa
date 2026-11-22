import assert from "node:assert/strict";
import test from "node:test";
import { databaseUrlFromEnv } from "./database-url.ts";

const base = {
  DB_HOST: "orbexa.example.ap-southeast-2.rds.amazonaws.com",
  DB_NAME: "orbexa",
  DB_USER: "orbexa",
  DB_PASSWORD: "p@ss/word #",
};

test("databaseUrlFromEnv URL-encodes the password and forces sslmode=require", () => {
  const url = databaseUrlFromEnv({ ...base, DB_SSLMODE: "require" });
  assert.equal(
    url,
    "postgresql://orbexa:p%40ss%2Fword%20%23@orbexa.example.ap-southeast-2.rds.amazonaws.com:5432/orbexa?sslmode=require&uselibpqcompat=true",
  );
  assert.equal(url.includes("p@ss/word #"), false);
});

test("databaseUrlFromEnv defaults the port and ssl mode", () => {
  const url = new URL(databaseUrlFromEnv(base));
  assert.equal(url.port, "5432");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(decodeURIComponent(url.password), "p@ss/word #");
});

test("databaseUrlFromEnv rejects a weaker ssl mode and a missing password", () => {
  assert.throws(() => databaseUrlFromEnv({ ...base, DB_SSLMODE: "disable" }), /DB_SSLMODE must be require/);
  assert.throws(() => databaseUrlFromEnv({ ...base, DB_PASSWORD: "" }), /DB_PASSWORD is required/);
  assert.throws(() => databaseUrlFromEnv({ ...base, DB_HOST: "host/name" }), /DB_HOST is invalid/);
});
