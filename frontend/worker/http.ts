export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const baseHeaders = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.github.com https://api.openai.com",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(baseHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function noContent(init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(baseHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(null, { status: 204, ...init, headers });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new HttpError(415, "请求必须使用 application/json");
  }

  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "JSON 请求体格式不正确");
  }
}

export function handleError(error: unknown) {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, details: error.details ?? null },
      { status: error.status },
    );
  }

  console.error(error);
  return json({ error: "服务暂时不可用" }, { status: 500 });
}

export function requireMethod(request: Request, methods: string[]) {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, `仅支持 ${methods.join(" / ")}`);
  }
}

export function cleanText(value: unknown, maxLength = 10_000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
