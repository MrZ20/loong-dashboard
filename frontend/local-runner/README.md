# LoongBoard Local Analysis Runner

The Runner is the only component allowed to access local repositories and the
OpenCode server. The browser and Cloudflare Worker communicate with it through
durable jobs and sanitized events.

1. Copy `runner.example.json` to `../.loongboard/runner.json` (the directory is
   ignored by Git), then configure the same `runnerToken` as
   `LOCAL_RUNNER_TOKEN` in the Worker environment.
2. Start the service, apply D1 migrations, then run `npm run runner`.
3. Enable Local Analysis on the LoongBoard settings page.

OpenCode is started on `127.0.0.1` by default. Source paths, OpenCode passwords
and provider credentials remain in the local Runner and are never returned to
the browser. OpenCode gets read/search/LSP tools only; Git access is performed
by fixed Runner commands without a general shell.
