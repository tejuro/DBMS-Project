/**
 * Pure session-token helpers shared by lib/auth.ts (server code) and proxy.ts
 * (which runs before every page render). No DB, no next/headers, no globals —
 * importing this module into Proxy is safe on the Node.js runtime.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "cc_session";

export type TokenRole = "ADMIN" | "DISPATCHER" | "CUSTOMER";

export type SessionPayload = {
  id: number;
  username: string;
  role: TokenRole;
  /** Unix timestamp in seconds. */
  exp: number;
};

/**
 * Development fallback only. Production deployments must set NEXTAUTH_SECRET;
 * without it the fallback is used so the local demo keeps working, but the
 * value is deliberately documented here as insecure and must be overridden.
 */
const DEV_FALLBACK_SECRET = "cold-chain-local-dev-only-session-secret-change-me";

let warnedAboutFallback = false;

function getSessionSecret(): string {
  const configured = process.env.NEXTAUTH_SECRET;
  if (configured && configured.length > 0) return configured;
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[auth] NEXTAUTH_SECRET is not set; using the documented development fallback secret. " +
        "Set a strong NEXTAUTH_SECRET before deploying."
    );
  }
  return DEV_FALLBACK_SECRET;
}

export function isRole(value: unknown): value is TokenRole {
  return value === "ADMIN" || value === "DISPATCHER" || value === "CUSTOMER";
}

export function signToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret())
    .update(encoded)
    .digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object") return null;

  const payload = decoded as Record<string, unknown>;
  if (
    typeof payload.id !== "number" ||
    !Number.isInteger(payload.id) ||
    payload.id <= 0 ||
    typeof payload.username !== "string" ||
    payload.username.length === 0 ||
    !isRole(payload.role) ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    id: payload.id,
    username: payload.username,
    role: payload.role,
    exp: payload.exp,
  };
}
