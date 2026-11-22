import assert from "node:assert/strict";
import test from "node:test";
import { validateIntake } from "./intake.ts";

const grantIntake = {
  type: "object",
  additionalProperties: false,
  required: ["sponsor"],
  properties: {
    sponsor: { type: "string", minLength: 3 },
    years: { type: "integer" },
  },
};

test("a specialist intake schema is data, not a tender form", () => {
  validateIntake(grantIntake, { sponsor: "Example Foundation", years: 2 });
  assert.throws(() => validateIntake(grantIntake, {}), /missing sponsor/);
  assert.throws(
    () => validateIntake(grantIntake, { sponsor: "Example Foundation", secret: "no" }),
    /not allowed/,
  );
  assert.throws(() => validateIntake(grantIntake, { sponsor: "Ex" }), /too short/);
  assert.throws(
    () => validateIntake(grantIntake, { sponsor: "Example Foundation", years: 1.5 }),
    /integer/,
  );
});
