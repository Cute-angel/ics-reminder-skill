import { randomBytes } from "node:crypto";

const defaultByteLength = 32;
const byteLengthArg = process.argv[2];
const byteLength = byteLengthArg == null ? defaultByteLength : Number.parseInt(byteLengthArg, 10);

if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
  console.error("Usage: node scripts/generate-reminder-api-token.mjs [byteLength]");
  console.error("byteLength must be an integer between 16 and 128.");
  process.exit(1);
}

const token = randomBytes(byteLength).toString("base64url");
console.log(`REMINDER_API_TOKEN=${token}`);
