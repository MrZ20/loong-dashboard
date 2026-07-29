import { first, run, type WorkerEnv } from "./db";
import { HttpError } from "./http";

const COOKIE_NAME = "loongboard_session";

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function createDevToken(
  env: WorkerEnv,
  email: string,
  displayName: string,
) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new HttpError(500, "本地会话密钥未配置");
  const payload = base64UrlEncode(
    JSON.stringify({
      email,
      displayName,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }),
  );
  return `${payload}.${await hmac(payload, secret)}`;
}

async function readDevToken(env: WorkerEnv, token: string | null) {
  if (!token || !env.SESSION_SECRET || env.ALLOW_DEV_AUTH !== "true") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (signature !== expected) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as {
      email: string;
      displayName: string;
      exp: number;
    };
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeForwardedName(request: Request) {
  const value = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (!value || encoding !== "percent-encoded-utf-8") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  mode: "chatgpt" | "development";
}

export async function getAuthenticatedUser(
  request: Request,
  env: WorkerEnv,
): Promise<AuthenticatedUser | null> {
  const forwardedEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  let email = forwardedEmail ?? "";
  let displayName = forwardedEmail ? decodeForwardedName(request) : "";
  let mode: AuthenticatedUser["mode"] = "chatgpt";

  if (!email) {
    const session = await readDevToken(env, readCookie(request, COOKIE_NAME));
    if (!session) return null;
    email = session.email.trim().toLowerCase();
    displayName = session.displayName;
    mode = "development";
  }

  if (!displayName) displayName = email.split("@")[0] || email;
  const now = new Date().toISOString();
  const existing = await first<Record<string, any>>(
    env,
    "SELECT * FROM users WHERE email = ?",
    [email],
  );
  const id = existing?.id ?? crypto.randomUUID();

  await run(
    env,
    `INSERT INTO users(id, email, display_name, created_at, last_seen_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       display_name = excluded.display_name,
       last_seen_at = excluded.last_seen_at`,
    [id, email, displayName, now, now],
  );

  return {
    id,
    email,
    displayName,
    avatarUrl: existing?.avatar_url ?? null,
    mode,
  };
}

export async function requireUser(request: Request, env: WorkerEnv) {
  const user = await getAuthenticatedUser(request, env);
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

export async function createDevelopmentSession(
  env: WorkerEnv,
  email: string,
  displayName: string,
) {
  if (env.ALLOW_DEV_AUTH !== "true") {
    throw new HttpError(404, "本地登录未启用");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, "请输入有效邮箱");
  }
  const token = await createDevToken(env, email.toLowerCase(), displayName || email);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
