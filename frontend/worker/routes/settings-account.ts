import {
  createTrustedDevelopmentSession,
  requireUser,
} from "../auth";
import type { WorkerEnv } from "../db";
import { cleanText, HttpError, json, readJson, requireMethod } from "../http";
import {
  createAccountRecord,
  findAccountById,
  getAccountProfile,
  getAccounts,
  saveAccountProfile,
} from "../services/account-settings";

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleAccountSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/profile") {
    if (request.method === "GET") {
      return json({ profile: await getAccountProfile(env, user.id), mode: user.mode });
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<Record<string, unknown>>(request);
    const displayName = cleanText(body.displayName, 100);
    if (!displayName) throw new HttpError(400, "显示名称不能为空");
    const profile = await saveAccountProfile(env, {
      userId: user.id,
      displayName,
      role: cleanText(body.role, 100),
      organization: cleanText(body.organization, 120),
      bio: cleanText(body.bio, 1_000),
    });
    return json({ profile });
  }

  if (path === "/api/settings/accounts") {
    if (request.method === "GET") {
      return json({
        accounts: await getAccounts(env, user.id, user.mode === "development"),
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
    const account = await createAccountRecord(env, {
      email,
      displayName,
      role: cleanText(body.role, 100),
      organization: cleanText(body.organization, 120),
    });
    if (!account) throw new HttpError(409, "该邮箱账户已经存在");
    return json({ account }, { status: 201 });
  }

  const switchMatch = matchPath(path, /^\/api\/settings\/accounts\/([^/]+)\/switch$/);
  if (switchMatch) {
    requireMethod(request, ["POST"]);
    if (user.mode !== "development" || env.ALLOW_DEV_AUTH !== "true") {
      throw new HttpError(403, "生产环境请通过 ChatGPT 登录切换账户");
    }
    const account = await findAccountById(env, switchMatch[0]);
    if (!account) throw new HttpError(404, "账户不存在");
    const cookie = await createTrustedDevelopmentSession(
      env,
      account.email,
      account.display_name,
      new URL(request.url).protocol === "https:",
    );
    return json({ ok: true }, { headers: { "set-cookie": cookie } });
  }

  throw new HttpError(404, "账户设置接口不存在");
}
