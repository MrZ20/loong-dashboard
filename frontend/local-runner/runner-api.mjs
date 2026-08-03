export class RunnerApi {
  constructor(config) {
    this.baseUrl = config.dashboardUrl;
    this.runnerId = config.runnerId;
    this.token = config.runnerToken;
  }

  async request(path, options = {}) {
    if (!this.token) throw new Error("缺少 LOONGBOARD_RUNNER_TOKEN，本地 Runner 无法连接 LoongBoard");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || "GET",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `LoongBoard Runner API 返回 ${response.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  heartbeat(payload) {
    return this.request("/api/local-runner/heartbeat", {
      method: "POST",
      body: { runnerId: this.runnerId, ...payload },
    });
  }

  async claim() {
    const body = await this.request("/api/local-runner/claim", {
      method: "POST",
      body: { runnerId: this.runnerId },
    });
    return body.job || null;
  }

  running(jobId) {
    return this.request(`/api/local-runner/jobs/${encodeURIComponent(jobId)}/running`, {
      method: "POST",
      body: { runnerId: this.runnerId },
    });
  }

  events(jobId, events) {
    if (!events.length) return Promise.resolve();
    return this.request(`/api/local-runner/jobs/${encodeURIComponent(jobId)}/events`, {
      method: "POST",
      body: { events },
    });
  }

  complete(jobId, status, result = {}, error = null) {
    return this.request(`/api/local-runner/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST",
      body: { runnerId: this.runnerId, status, result, error },
      timeoutMs: 60_000,
    });
  }

  async status(jobId) {
    const body = await this.request(`/api/local-runner/jobs/${encodeURIComponent(jobId)}`);
    return body.status;
  }
}
