import { createDevelopmentSession, requireUser } from "./auth";
import { encryptCredential } from "./credentials";
import { first, query, run, type WorkerEnv } from "./db";
import {
  cleanText,
  HttpError,
  json,
  noContent,
  readJson,
  requireMethod,
} from "./http";

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

async function ensureProfile(env: WorkerEnv, userId: string) {
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO user_profiles(user_id, updated_at)
     VALUES(?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, now],
  );
}

function mapAccount(row: Record<string, any>, currentUserId: string) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role ?? "",
    organization: row.organization ?? "",
    bio: row.bio ?? "",
    current: row.id === currentUserId,
    lastSeenAt: row.last_seen_at,
  };
}

function mapProvider(row: Record<string, any>, activeId: string) {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiMode: row.api_mode,
    model: row.model,
    tokenConfigured: Boolean(row.encrypted_token),
    tokenHint: row.token_hint,
    active: row.id === activeId,
    builtIn: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateProviderUrl(env: WorkerEnv, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "请输入有效的 AI API Base URL");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(env.ALLOW_DEV_AUTH === "true" && localHost)) {
    throw new HttpError(400, "AI API 地址必须使用 HTTPS；本地调试可使用 localhost");
  }
  if (
    env.ALLOW_DEV_AUTH !== "true" &&
    (/^(10|127|169\.254|192\.168)\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
      localHost)
  ) {
    throw new HttpError(400, "生产环境不能连接私有网络 AI 地址");
  }
  return url.toString().replace(/\/+$/, "");
}

async function accountRows(env: WorkerEnv, userId?: string) {
  return query<Record<string, any>>(
    env,
    `SELECT users.*, user_profiles.role, user_profiles.organization,
      user_profiles.bio
     FROM users
     LEFT JOIN user_profiles ON user_profiles.user_id = users.id
     ${userId ? "WHERE users.id = ?" : ""}
     ORDER BY users.last_seen_at DESC`,
    userId ? [userId] : [],
  );
}

async function handleProfile(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  await ensureProfile(env, user.id);
  if (request.method === "GET") {
    const row = (await accountRows(env, user.id))[0];
    return json({ profile: mapAccount(row, user.id), mode: user.mode });
  }

  requireMethod(request, ["PUT"]);
  const body = await readJson<Record<string, unknown>>(request);
  const displayName = cleanText(body.displayName, 100);
  if (!displayName) throw new HttpError(400, "显示名称不能为空");
  const now = new Date().toISOString();
  await run(env, "UPDATE users SET display_name = ? WHERE id = ?", [
    displayName,
    user.id,
  ]);
  await run(
    env,
    `UPDATE user_profiles SET role = ?, organization = ?, bio = ?, updated_at = ?
     WHERE user_id = ?`,
    [
      cleanText(body.role, 100),
      cleanText(body.organization, 120),
      cleanText(body.bio, 1_000),
      now,
      user.id,
    ],
  );
  const row = (await accountRows(env, user.id))[0];
  return json({ profile: mapAccount(row, user.id) });
}

async function handleAccounts(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  if (request.method === "GET") {
    const rows = await accountRows(
      env,
      user.mode === "development" ? undefined : user.id,
    );
    return json({
      accounts: rows.map((row) => mapAccount(row, user.id)),
      canAdd: user.mode === "development",
    });
  }

  requireMethod(request, ["POST"]);
  if (user.mode !== "development" || env.ALLOW_DEV_AUTH !== "true") {
    throw new HttpError(403, "生产账户由 ChatGPT 登录管理，不能在应用内创建");
  }
  const body = await readJson<Record<string, unknown>>(request);
  const email = cleanText(body.email, 200).toLowerCase();
  const displayName = cleanText(body.displayName, 100);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, "请输入有效邮箱");
  }
  if (!displayName) throw new HttpError(400, "账户名称不能为空");
  if (await first(env, "SELECT id FROM users WHERE email = ?", [email])) {
    throw new HttpError(409, "该邮箱账户已经存在");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO users(id, email, display_name, created_at, last_seen_at)
     VALUES(?, ?, ?, ?, ?)`,
    [id, email, displayName, now, now],
  );
  await run(
    env,
    `INSERT INTO user_profiles(
      user_id, role, organization, bio, updated_at
    ) VALUES(?, ?, ?, ?, ?)`,
    [
      id,
      cleanText(body.role, 100),
      cleanText(body.organization, 120),
      cleanText(body.bio, 1_000),
      now,
    ],
  );
  const row = (await accountRows(env, id))[0];
  return json({ account: mapAccount(row, user.id) }, { status: 201 });
}

async function switchAccount(
  request: Request,
  env: WorkerEnv,
  accountId: string,
) {
  const current = await requireUser(request, env);
  requireMethod(request, ["POST"]);
  if (current.mode !== "development" || env.ALLOW_DEV_AUTH !== "true") {
    throw new HttpError(403, "生产环境请通过 ChatGPT 登录切换账户");
  }
  const account = await first<Record<string, any>>(
    env,
    "SELECT * FROM users WHERE id = ?",
    [accountId],
  );
  if (!account) throw new HttpError(404, "账户不存在");
  const cookie = await createDevelopmentSession(
    env,
    account.email,
    account.display_name,
  );
  return json(
    { ok: true },
    { headers: { "set-cookie": cookie } },
  );
}

async function listProviders(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  requireMethod(request, ["GET"]);
  await ensureProfile(env, user.id);
  const profile = await first<Record<string, any>>(
    env,
    "SELECT active_ai_provider_id FROM user_profiles WHERE user_id = ?",
    [user.id],
  );
  const activeId = profile?.active_ai_provider_id || "environment";
  const rows = await query<Record<string, any>>(
    env,
    "SELECT * FROM ai_providers WHERE user_id = ? ORDER BY updated_at DESC",
    [user.id],
  );
  return json({
    providers: [
      {
        id: "environment",
        name: "环境变量 OpenAI-compatible",
        providerType: "openai-compatible",
        baseUrl: env.AI_API_BASE_URL || "https://api.openai.com/v1",
        apiMode:
          env.AI_API_MODE === "responses" ? "responses" : "chat_completions",
        model: env.AI_MODEL || "gpt-5-mini",
        tokenConfigured: Boolean(env.AI_API_KEY),
        tokenHint: "",
        active: activeId === "environment",
        builtIn: true,
      },
      ...rows.map((row) => mapProvider(row, activeId)),
    ],
  });
}

async function saveProvider(
  request: Request,
  env: WorkerEnv,
  providerId?: string,
) {
  const user = await requireUser(request, env);
  requireMethod(request, [providerId ? "PUT" : "POST"]);
  const body = await readJson<Record<string, unknown>>(request);
  const existing = providerId
    ? await first<Record<string, any>>(
        env,
        "SELECT * FROM ai_providers WHERE id = ? AND user_id = ?",
        [providerId, user.id],
      )
    : null;
  if (providerId && !existing) throw new HttpError(404, "AI 配置不存在");

  const name = cleanText(body.name, 100) || existing?.name;
  const baseUrl = validateProviderUrl(
    env,
    cleanText(body.baseUrl, 500) || existing?.base_url || "",
  );
  const apiMode =
    body.apiMode === "responses" || body.apiMode === "chat_completions"
      ? body.apiMode
      : existing?.api_mode || "responses";
  const model = cleanText(body.model, 120) || existing?.model;
  if (!name || !model) throw new HttpError(400, "配置名称和模型不能为空");
  const duplicate = await first<Record<string, any>>(
    env,
    "SELECT id FROM ai_providers WHERE user_id = ? AND name = ?",
    [user.id, name],
  );
  if (duplicate && duplicate.id !== existing?.id) {
    throw new HttpError(409, "同名 AI 配置已经存在");
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const encryptedToken = token
    ? await encryptCredential(env, token)
    : existing?.encrypted_token || "";
  const tokenHint = token ? token.slice(-4) : existing?.token_hint || "";
  const id = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  if (existing) {
    await run(
      env,
      `UPDATE ai_providers SET name = ?, base_url = ?, api_mode = ?, model = ?,
        encrypted_token = ?, token_hint = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        name,
        baseUrl,
        apiMode,
        model,
        encryptedToken,
        tokenHint,
        now,
        id,
        user.id,
      ],
    );
  } else {
    await run(
      env,
      `INSERT INTO ai_providers(
        id, user_id, name, base_url, api_mode, model, encrypted_token,
        token_hint, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        user.id,
        name,
        baseUrl,
        apiMode,
        model,
        encryptedToken,
        tokenHint,
        now,
        now,
      ],
    );
  }
  await ensureProfile(env, user.id);
  if (body.makeActive === true) {
    await run(
      env,
      "UPDATE user_profiles SET active_ai_provider_id = ?, updated_at = ? WHERE user_id = ?",
      [id, now, user.id],
    );
  }
  const row = await first<Record<string, any>>(
    env,
    "SELECT * FROM ai_providers WHERE id = ? AND user_id = ?",
    [id, user.id],
  );
  const profile = await first<Record<string, any>>(
    env,
    "SELECT active_ai_provider_id FROM user_profiles WHERE user_id = ?",
    [user.id],
  );
  return json(
    { provider: mapProvider(row!, profile?.active_ai_provider_id) },
    { status: existing ? 200 : 201 },
  );
}

async function activateProvider(
  request: Request,
  env: WorkerEnv,
  providerId: string,
) {
  const user = await requireUser(request, env);
  requireMethod(request, ["POST"]);
  if (
    providerId !== "environment" &&
    !(await first(
      env,
      "SELECT id FROM ai_providers WHERE id = ? AND user_id = ?",
      [providerId, user.id],
    ))
  ) {
    throw new HttpError(404, "AI 配置不存在");
  }
  await ensureProfile(env, user.id);
  await run(
    env,
    "UPDATE user_profiles SET active_ai_provider_id = ?, updated_at = ? WHERE user_id = ?",
    [providerId, new Date().toISOString(), user.id],
  );
  return json({ ok: true, activeProviderId: providerId });
}

async function deleteProvider(
  request: Request,
  env: WorkerEnv,
  providerId: string,
) {
  const user = await requireUser(request, env);
  requireMethod(request, ["DELETE"]);
  if (providerId === "environment") {
    throw new HttpError(400, "环境变量配置不能删除");
  }
  const provider = await first(
    env,
    "SELECT id FROM ai_providers WHERE id = ? AND user_id = ?",
    [providerId, user.id],
  );
  if (!provider) throw new HttpError(404, "AI 配置不存在");
  await run(
    env,
    "DELETE FROM ai_providers WHERE id = ? AND user_id = ?",
    [providerId, user.id],
  );
  await ensureProfile(env, user.id);
  await run(
    env,
    `UPDATE user_profiles
     SET active_ai_provider_id = 'environment', updated_at = ?
     WHERE user_id = ? AND active_ai_provider_id = ?`,
    [new Date().toISOString(), user.id, providerId],
  );
  return noContent();
}

export async function handleSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  if (path === "/api/settings/profile") return handleProfile(request, env);
  if (path === "/api/settings/accounts") return handleAccounts(request, env);

  const accountSwitch = matchPath(
    path,
    /^\/api\/settings\/accounts\/([^/]+)\/switch$/,
  );
  if (accountSwitch) {
    return switchAccount(request, env, accountSwitch[0]);
  }

  if (path === "/api/settings/ai-providers") {
    if (request.method === "GET") return listProviders(request, env);
    return saveProvider(request, env);
  }
  const activate = matchPath(
    path,
    /^\/api\/settings\/ai-providers\/([^/]+)\/activate$/,
  );
  if (activate) return activateProvider(request, env, activate[0]);

  const provider = matchPath(
    path,
    /^\/api\/settings\/ai-providers\/([^/]+)$/,
  );
  if (provider) {
    if (request.method === "DELETE") {
      return deleteProvider(request, env, provider[0]);
    }
    return saveProvider(request, env, provider[0]);
  }
  throw new HttpError(404, "设置接口不存在");
}
