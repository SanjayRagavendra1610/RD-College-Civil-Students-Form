import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_EMAILS = new Set(["rdccpscollege@gmail.com", "rdccpcollege@gmail.com"]);
const SESSION_SECONDS = 8 * 60 * 60;

export function allowedOrigin() {
  return process.env.ALLOWED_ORIGIN || new URL(process.env.URL || "http://localhost:8888").origin;
}

export function response(statusCode, body, origin = "") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    },
    body: JSON.stringify(body),
  };
}

export function allowedOrigins() {
  const origins = new Set([allowedOrigin()]);
  for (const value of [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    try {
      if (value) origins.add(new URL(value).origin);
    } catch {}
  }
  return origins;
}

export function isAllowedOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  return !origin || allowedOrigins().has(origin);
}

export function optionsResponse(event, methods) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  if (!isAllowedOrigin(event)) return response(403, { success: false, error: "Origin not allowed." });
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": origin || allowedOrigin(),
      "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
    body: "",
  };
}

function secureEqual(actual, expected) {
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAdminSession(email) {
  const key = process.env.ADMIN_ACCESS_KEY;
  if (!key) throw new Error("ADMIN_ACCESS_KEY is not configured.");
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function checkAdminCredentials(email, password) {
  const key = process.env.ADMIN_ACCESS_KEY;
  if (!key || !password) return false;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return ADMIN_EMAILS.has(normalizedEmail) && secureEqual(password, key);
}

export function hasAdminSession(event) {
  const key = process.env.ADMIN_ACCESS_KEY;
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key || !token) return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  if (!secureEqual(signature, expected)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return ADMIN_EMAILS.has(String(claims.email || "").toLowerCase()) &&
      Number.isFinite(claims.exp) && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
