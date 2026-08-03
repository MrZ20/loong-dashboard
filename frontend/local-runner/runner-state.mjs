import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class RunnerState {
  constructor(path) {
    this.path = path;
    this.value = { sessions: {} };
    if (existsSync(path)) {
      try {
        this.value = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        this.value = { sessions: {} };
      }
    }
  }

  session(sessionId) {
    return this.value.sessions?.[sessionId] || null;
  }

  saveSession(sessionId, value) {
    this.value.sessions ||= {};
    this.value.sessions[sessionId] = { ...value, updatedAt: new Date().toISOString() };
    this.flush();
  }

  removeSession(sessionId) {
    if (this.value.sessions) delete this.value.sessions[sessionId];
    this.flush();
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.value, null, 2), { mode: 0o600 });
  }
}
