// Fork: putting the mail gate (mcp-mail-gate.ts) in front of every custom
// MCP server that has an `outbound` setting, before any driver sees it. Done
// once here rather than in each driver: every engine then mounts an ordinary
// command server, and none of them can mount the real one unguarded.
import { createHash } from "node:crypto";

import type { McpServerSpec, StdioMcpSpec } from "./contracts.ts";
import { mcpStdioServer } from "./mcp-gate-config.ts";
import { MAIL_GATE_ENV, type McpMailSpec } from "./mcp-mail.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

/** The gated form of one server, or null when it cannot be mounted (then it
 * must not be mounted at all). */
export function mailGateServer(input: {
  name: string;
  server: McpServerSpec;
  spec: McpMailSpec;
  /** The harness, and the turn's bearer for /api/internal/mcp-mail. */
  url: string;
  token: string;
  nodeEnv?: Record<string, string>;
  execPath?: string;
}): StdioMcpSpec | null {
  const upstream = mcpStdioServer(input.server, { nodeEnv: input.nodeEnv, execPath: input.execPath });
  if (!upstream) return null;
  const envName = `OPENMAUSBOT_MAIL_GATE_${createHash("sha256").update(input.name).digest("hex")}`;
  if (!MAIL_GATE_ENV.test(envName)) return null;
  return {
    command: input.execPath ?? process.execPath,
    args: [SPAWNED_PROXIES.mcpMail, "--config-env", envName],
    env: {
      ...input.nodeEnv,
      [envName]: JSON.stringify({
        name: input.name,
        spec: input.spec,
        upstream: { command: upstream.command, args: upstream.args ?? [], env: upstream.env ?? {} },
        url: input.url,
        token: input.token,
      }),
    },
  };
}

/** `servers` with every server named in `specs` behind the mail gate. A
 * server that cannot be gated is left out, never mounted bare. */
export function withMailGates(
  servers: Record<string, McpServerSpec>,
  specs: Record<string, McpMailSpec>,
  connection: () => { url: string; token: string },
  nodeEnv?: Record<string, string>,
): Record<string, McpServerSpec> {
  const names = Object.keys(servers).filter((name) => specs[name]);
  if (!names.length) return servers;
  const { url, token } = connection();
  const out: Record<string, McpServerSpec> = { ...servers };
  for (const name of names) {
    const gated = mailGateServer({ name, server: servers[name]!, spec: specs[name]!, url, token, nodeEnv });
    if (gated) out[name] = gated;
    else delete out[name];
  }
  return out;
}
