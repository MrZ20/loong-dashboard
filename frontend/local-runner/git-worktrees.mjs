import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const REPOSITORY_IDS = ["vllm", "vllm-ascend"];

export function repositoryPreparationAction(path) {
  return existsSync(path) ? "fetch" : "clone";
}

export function worktreeAddArgs(repositoryPath, worktreePath, commit) {
  return ["-C", repositoryPath, "worktree", "add", "--detach", worktreePath, commit];
}

export function canReuseRetainedWorktree(retained, repositories, explicitCommit, repoScope) {
  return Boolean(
    retained &&
    (!explicitCommit || retained.commits?.[repoScope] === explicitCommit) &&
    repositories.every((repo) => retained.commits?.[repo] && existsSync(retained.worktrees?.[repo])),
  );
}

function inside(root, candidate) {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

export function safeRelativePath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("..")) return null;
  if (path === ".env" || path.startsWith(".env.") || path.includes("/.env")) return null;
  return path.replace(/^\.\//, "");
}

export async function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxOutput = options.maxOutput || 2_000_000;
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-maxOutput); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-maxOutput); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs || 120_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${command} ${args.join(" ")} 失败：${stderr.trim().slice(0, 1_000)}`));
    });
  });
}

export class GitWorktreeManager {
  constructor(config, emit) {
    this.config = config;
    this.emit = emit;
  }

  repoPath(repository) {
    if (!REPOSITORY_IDS.includes(repository)) throw new Error(`不允许访问仓库：${repository}`);
    return resolve(this.config.repositories[repository]);
  }

  async status(repository) {
    const path = this.repoPath(repository);
    if (!existsSync(path)) return { configured: true, exists: false, git: false, head: null };
    try {
      const { stdout } = await runProcess("git", ["-C", path, "rev-parse", "HEAD"], { timeoutMs: 15_000 });
      return { configured: true, exists: true, git: true, head: stdout.slice(0, 12) };
    } catch {
      return { configured: true, exists: true, git: false, head: null };
    }
  }

  async initialize(repository) {
    const path = this.repoPath(repository);
    if (repositoryPreparationAction(path) === "fetch") {
      await this.fetch(repository);
      return this.status(repository);
    }
    mkdirSync(dirname(path), { recursive: true });
    await this.emit("repository_prepare", "git", `正在初始化 ${repository} 本地仓库`, { repository });
    await runProcess("git", ["clone", "--filter=blob:none", "--no-checkout", this.config.cloneUrls[repository], path], {
      timeoutMs: 15 * 60_000,
    });
    return this.status(repository);
  }

  async fetch(repository, pullNumber = null) {
    const path = this.repoPath(repository);
    const status = await this.status(repository);
    if (!status.git) throw new Error(`${repository} 本地仓库不存在，请先执行初始化仓库`);
    await this.emit("git_fetch", "git", `[Git] 正在更新 ${repository} 远端引用`, { repository });
    await runProcess("git", ["-C", path, "fetch", "--prune", "origin"], { timeoutMs: 10 * 60_000 });
    if (pullNumber) {
      try {
        await runProcess("git", ["-C", path, "fetch", "origin", `pull/${pullNumber}/head`], { timeoutMs: 5 * 60_000 });
      } catch {
        // The normal fetch may already contain the requested SHA. Resolution below is authoritative.
      }
    }
  }

  async resolveCommit(repository, ref) {
    const path = this.repoPath(repository);
    const implicit = !ref || ref === "HEAD";
    const target = implicit ? "origin/main" : ref;
    try {
      const { stdout } = await runProcess("git", ["-C", path, "rev-parse", `${target}^{commit}`], { timeoutMs: 30_000 });
      return stdout;
    } catch {
      if (implicit) {
        const { stdout } = await runProcess("git", ["-C", path, "rev-parse", "HEAD^{commit}"], { timeoutMs: 30_000 });
        return stdout;
      }
      throw new Error(`${repository} 无法解析分析版本 ${target}`);
    }
  }

  async createWorktree(runId, repository, commit, label = "head") {
    const repoPath = this.repoPath(repository);
    const path = resolve(this.config.worktreeRoot, runId, `${repository}-${label}`);
    if (!inside(this.config.worktreeRoot, path)) throw new Error("Worktree 路径越界");
    if (existsSync(path)) {
      await runProcess("git", ["-C", repoPath, "worktree", "remove", "--force", path], { timeoutMs: 60_000 }).catch(() => {
        rmSync(path, { recursive: true, force: true });
      });
    }
    mkdirSync(dirname(path), { recursive: true });
    await runProcess("git", worktreeAddArgs(repoPath, path, commit), { timeoutMs: 5 * 60_000 });
    await this.emit("worktree_create", "git", `[Git] 已创建 ${repository}@${commit.slice(0, 12)} 的只读分析 Worktree`, {
      repository,
      commitSha: commit,
    });
    return path;
  }

  async prepare(job, state) {
    const request = job.request || {};
    let repositories;
    if (job.repoScope === "both" || job.repoScope === "all") repositories = [...REPOSITORY_IDS];
    else if (job.repoScope === "current") repositories = request.repository ? [request.repository] : ["vllm-ascend"];
    else if (REPOSITORY_IDS.includes(job.repoScope)) repositories = [job.repoScope];
    else {
      repositories = [...new Set((request.targets || []).map((target) => target?.repo).filter((repo) => REPOSITORY_IDS.includes(repo)))];
    }
    if (!repositories.length) throw new Error("任务没有可分析的本地仓库");

    const retained = job.opencodeSessionId ? state.session(job.opencodeSessionId) : null;
    const explicitCommit = job.headSha || (/^[0-9a-f]{40}$/i.test(job.targetRef || "") ? job.targetRef : null);
    if (canReuseRetainedWorktree(retained, repositories, explicitCommit, job.repoScope)) {
      return { root: retained.root, worktrees: retained.worktrees, commits: retained.commits, reused: true };
    }

    const worktrees = {};
    const commits = {};
    for (const repository of repositories) {
      if (request.autoFetch !== false && this.config.autoFetch) {
        await this.fetch(repository, request.number || null);
      } else {
        const status = await this.status(repository);
        if (!status.git) throw new Error(`${repository} 本地仓库不存在，请先初始化`);
      }
      const target = repository === job.repoScope
        ? job.headSha || job.targetRef || "HEAD"
        : request.targets?.find((target) => target?.repo === repository)?.commit || "HEAD";
      const commit = await this.resolveCommit(repository, target);
      commits[repository] = commit;
      worktrees[repository] = await this.createWorktree(job.id, repository, commit, "head");
      if (repository === job.repoScope && job.baseSha && job.baseSha !== commit) {
        const baseCommit = await this.resolveCommit(repository, job.baseSha);
        worktrees[`${repository}:base`] = await this.createWorktree(job.id, repository, baseCommit, "base");
      }
    }
    return { root: resolve(this.config.worktreeRoot, job.id), worktrees, commits, reused: false };
  }

  validateReferences(references, prepared) {
    if (!Array.isArray(references)) return [];
    return references.flatMap((reference) => {
      const repository = reference?.repository;
      const relativePath = safeRelativePath(reference?.path);
      const root = prepared.worktrees[repository];
      if (!root || !relativePath || reference?.commitSha !== prepared.commits[repository]) return [];
      const absolute = resolve(root, relativePath);
      if (!inside(root, absolute) || !existsSync(absolute)) return [];
      return [{
        repository,
        commitSha: prepared.commits[repository],
        path: relativePath,
        symbol: String(reference.symbol || "未指定符号").slice(0, 500),
        startLine: Number.isInteger(reference.startLine) && reference.startLine > 0 ? reference.startLine : null,
        endLine: Number.isInteger(reference.endLine) && reference.endLine > 0 ? reference.endLine : null,
        reason: String(reference.reason || "").slice(0, 1_000),
      }];
    });
  }

  async gitEvidence(repository, baseSha, headSha) {
    const repoPath = this.repoPath(repository);
    const result = [];
    if (baseSha && headSha) {
      const { stdout } = await runProcess("git", ["-C", repoPath, "diff", "--stat", baseSha, headSha], { timeoutMs: 60_000 });
      result.push(`git diff --stat ${baseSha.slice(0, 12)}..${headSha.slice(0, 12)}\n${stdout}`);
      const log = await runProcess("git", ["-C", repoPath, "log", "--oneline", "--no-decorate", `${baseSha}..${headSha}`], { timeoutMs: 60_000 });
      result.push(`git log ${baseSha.slice(0, 12)}..${headSha.slice(0, 12)}\n${log.stdout}`);
    } else if (headSha) {
      const show = await runProcess("git", ["-C", repoPath, "show", "--stat", "--oneline", headSha], { timeoutMs: 60_000 });
      result.push(show.stdout);
    }
    return result;
  }

  async cleanupExpired(retentionHours = this.config.worktreeRetentionHours) {
    if (!existsSync(this.config.worktreeRoot)) return 0;
    const { readdirSync } = await import("node:fs");
    let removed = 0;
    for (const entry of readdirSync(this.config.worktreeRoot)) {
      const path = resolve(this.config.worktreeRoot, entry);
      if (!inside(this.config.worktreeRoot, path)) continue;
      const age = Date.now() - statSync(path).mtimeMs;
      if (age < retentionHours * 3_600_000) continue;
      for (const repository of REPOSITORY_IDS) {
        const repoPath = this.repoPath(repository);
        for (const label of ["head", "base"]) {
          const worktree = resolve(path, `${repository}-${label}`);
          if (existsSync(worktree)) {
            await runProcess("git", ["-C", repoPath, "worktree", "remove", "--force", worktree], { timeoutMs: 60_000 }).catch(() => {});
          }
        }
      }
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }
}
