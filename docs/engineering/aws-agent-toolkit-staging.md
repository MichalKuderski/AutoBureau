# AWS Agent Toolkit staging setup

Installed September 12, 2026, following the [official setup guide](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md).

The local `pellum-staging` profile uses temporary AWS login credentials for account `792394000571`. Resource defaults are Ohio (`us-east-2`). Toolkit's MCP control endpoint is in `us-east-1`; this does not change the application's resource region. No access key, IAM role, bucket or model invocation was created by setup.

The AWS CLI installed its default skill set and generated Codex/Claude MCP entries. Existing settings were backed up and preserved. Project guardrails were retained before appending the official AWS guidance. The Secrets Manager skill was added separately because the guidance requires it. Do not retrieve secret values into agent context.

The generated `uvx mcp-proxy-for-aws@latest` command remains intact. Its environment selects only the isolated staging profile/config/cache, disables metadata fallback and pins the installed Python 3.12 runtime. Pinning Python avoids an unnecessary native cryptography build encountered with the older default interpreter. Profile/config/cache directories are private; the shared-credentials file is empty. Login renewal remains a user/MFA action.

Verification: MCP `initialize` succeeded with protocol `2025-03-26`; `tools/list` returned eight AWS tools. No mutation tool was called. The current Codex session may need a restart before discovering newly installed MCP tools; the existing scoped AWS CLI remains available meanwhile. OpenClaw MCP configuration is not supported by the automatic installer and was not manually added.

This setup is not an infrastructure approval. ADR-016's pre-apply proofs and exact saved-plan review still apply. Production, live intake, worker/model processing and unredacted model input remain prohibited.
