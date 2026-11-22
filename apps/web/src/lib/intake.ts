export type JsonSchema = {
  type?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, { type?: string; enum?: unknown[]; minLength?: number }>;
};

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeError";
  }
}

export function validateIntake(schema: JsonSchema, payload: unknown): void {
  if (schema.type !== "object") {
    throw new IntakeError("intake schema must be a JSON object schema");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new IntakeError("intake must be an object");
  }
  const record = payload as Record<string, unknown>;
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in record)) {
      throw new IntakeError(`intake missing ${key}`);
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) {
        throw new IntakeError(`intake property ${key} is not allowed`);
      }
    }
  }
  for (const [key, prop] of Object.entries(properties)) {
    if (!(key in record)) {
      continue;
    }
    const value = record[key];
    if (typeof value === "boolean" && prop.type !== "boolean") {
      throw new IntakeError(`intake property ${key} must be a ${prop.type}`);
    }
    if (prop.type === "string" && typeof value !== "string") {
      throw new IntakeError(`intake property ${key} must be a string`);
    }
    if (prop.type === "boolean" && typeof value !== "boolean") {
      throw new IntakeError(`intake property ${key} must be a boolean`);
    }
    if ((prop.type === "number" || prop.type === "integer") && typeof value !== "number") {
      throw new IntakeError(`intake property ${key} must be a number`);
    }
    if (prop.type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
      throw new IntakeError(`intake property ${key} must be an integer`);
    }
    if (prop.enum && !prop.enum.includes(value)) {
      throw new IntakeError(`intake property ${key} is not an allowed value`);
    }
    if (typeof prop.minLength === "number" && typeof value === "string" && value.length < prop.minLength) {
      throw new IntakeError(`intake property ${key} is too short`);
    }
  }
}
