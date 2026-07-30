import type { WorkerEnv } from "./db";
import { HttpError } from "./http";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialKey(env: WorkerEnv) {
  const secret = env.CREDENTIALS_ENCRYPTION_KEY || env.SESSION_SECRET;
  if (!secret) {
    throw new HttpError(500, "AI Token 加密密钥未配置");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptCredential(env: WorkerEnv, value: string) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await credentialKey(env),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(env: WorkerEnv, value: string) {
  if (!value) return "";
  const [ivValue, encryptedValue] = value.split(".");
  if (!ivValue || !encryptedValue) {
    throw new HttpError(500, "AI Token 密文格式不正确");
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(ivValue) },
      await credentialKey(env),
      base64UrlToBytes(encryptedValue),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new HttpError(500, "AI Token 无法解密，请在设置中重新保存");
  }
}
