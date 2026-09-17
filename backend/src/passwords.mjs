import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64);
  return salt + ":" + hash.toString("hex");
}
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || !stored) return false;
  const [salt, hash] = stored.split(":");
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
