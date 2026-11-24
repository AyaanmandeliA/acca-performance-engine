// Part of ../../PROJECT.md — strict JSON Schema validation for manual imports.
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(readFileSync(new URL("../../DIAGNOSTIC_OUTPUT_SCHEMA.json", import.meta.url), "utf8"));
const input = readFileSync(0, "utf8");

try {
  const document = JSON.parse(input);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    const details = (validate.errors ?? []).slice(0, 12).map((error) => `${error.instancePath || "$"} ${error.message}`).join("; ");
    process.stderr.write(`Strict diagnostic schema validation failed: ${details}\n`);
    process.exit(2);
  }
  process.stdout.write("valid\n");
} catch (error) {
  process.stderr.write(`Invalid diagnostic JSON: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
