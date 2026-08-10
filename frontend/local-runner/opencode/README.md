# OpenCode deployment profile

This directory is the default `OPENCODE_CONFIG_DIR` used by the LoongBoard Local Runner.
The checked-in `opencode.json` blocks external directories and common credential files.
Each Session receives a complete deny-by-default rule set from the Runner, including its
allowed tools, Git/gh command patterns, network policy and write policy.

The Runner supplies the selected task permission profile again when it creates an OpenCode
Session. A task prompt cannot change that profile. The effective permission is governed by:

1. the OpenCode deployment configuration;
2. `allowedPermissionProfiles` in `.loongboard/runner.json`;
3. the profile selected for the LoongBoard AI task;
4. the workspace mode prepared for the run.

`worktree_development` is intentionally absent from the example Runner allow-list. Enable it
only on a trusted local deployment and only for tasks using `ephemeral_worktree` or retained
`worktree`. Source writes always happen in an isolated Worktree; the Runner never switches the
shared repository checkout.

OpenCode credentials and provider keys stay in the local OpenCode installation. They must not
be copied into D1 or returned to the browser.
