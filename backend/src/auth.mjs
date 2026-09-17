import { randomBytes } from "node:crypto";
import { db } from "./db.mjs";
import { digest, verifyPassword } from "./passwords.mjs";
const cookieName = "northstar_session";
const cookieOptions = { httpOnly: true, sameSite: "strict", path: "/api" };
function token(req) {
  return (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
}
export async function login(req, res) {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string")
    return res.status(400).json({ message: "Enter your email and password." });
  const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !await verifyPassword(password, user.password_hash))
    return res.status(401).json({ message: "Email or password is incorrect." });
  const old = token(req);
  if (old) await db.query("DELETE FROM sessions WHERE token_hash = $1", [digest(old)]);
  const secret = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now() + interval '8 hours')", [digest(secret), user.id]);
  res.cookie(cookieName, secret, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}
export async function logout(req, res) {
  const secret = token(req);
  if (secret) await db.query("DELETE FROM sessions WHERE token_hash = $1", [digest(secret)]);
  res.clearCookie(cookieName, cookieOptions);
  res.json({ message: "Signed out" });
}
export async function requireUser(req, res, next) {
  try {
    const secret = token(req);
    if (!secret) return res.status(401).json({ message: "Please sign in." });
    const { rows } = await db.query(
      "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()", [digest(secret)]);
    if (!rows[0]) return res.status(401).json({ message: "Your session has expired. Please sign in again." });
    req.user = rows[0];
    req.userId = rows[0].id;
    next();
  } catch (error) { next(error); }
}
export async function requireAgent(req, res, next) {
  try {
    const agentId = req.header("x-agent-id");
    const apiKey = req.header("x-api-key");
    if (!agentId || !apiKey) return res.status(401).json({ message: "Agent credentials are required" });
    const { rows } = await db.query(
      'SELECT id, name, type, organization_id AS "organizationId", owner_user_id AS "ownerUserId", status FROM agents WHERE id=$1 AND api_key_hash=$2',
      [agentId, digest(apiKey)]);
    if (!rows[0] || rows[0].status !== "ACTIVE") return res.status(401).json({ message: "Invalid or inactive agent credentials" });
    req.agent = rows[0];
    next();
  } catch (error) { next(error); }
}
