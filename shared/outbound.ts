// Outbound actions: the calls that reach a person outside the app, or move
// money. Sending an email, replying in a thread, posting to a channel,
// publishing, inviting, sharing, refunding, charging. These get their own
// confirmation regardless of approval level, and an optional daily
// allowance per bot, because the cost of one wrong send is paid by someone
// who never saw the bot.
//
// Shared between the harness (which enforces it) and the app (which shows
// the setting), so both agree on what "outbound" means.

export type OutboundPolicy = {
  /** ask: every outbound call waits for a tap. allow: up to dailyCap a day. */
  policy: "ask" | "allow";
  dailyCap: number;
};

export const OUTBOUND_DEFAULT_CAP = 25;
const OUTBOUND_MAX_CAP = 1_000;

/** Tools whose action is one of these words send something somewhere. */
const SEND_VERBS = new Set([
  "SEND",
  "SENDS",
  "REPLY",
  "RESPOND",
  "FORWARD",
  "POST",
  "PUBLISH",
  "TWEET",
  "RETWEET",
  "BROADCAST",
  "INVITE",
  "SHARE",
  "REFUND",
  "CHARGE",
  "PAY",
  "PAYOUT",
  "TRANSFER",
]);

/** Creating one of these is sending it: a created comment is a comment
 * someone reads, a created invoice is one someone receives. */
const CREATE_VERBS = new Set(["CREATE", "CREATION", "ADD", "NEW"]);
const SENT_NOUNS = new Set(["MESSAGE", "COMMENT", "POST", "EMAIL", "MAIL", "INVOICE", "PAYMENT", "REFUND", "REPLY", "TWEET", "DM"]);

/** A read verb first means the rest of the name is what is being read:
 * REDDIT_GET_POST fetches a post, it does not post. */
const READ_VERBS = new Set(["GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "RETRIEVE", "LOOKUP", "DOWNLOAD", "VIEW", "CHECK", "COUNT"]);

/** The action part of a tool name, as upper-case word tokens. Composio's
 * TOOLKIT_ACTION drops its toolkit; an MCP server's mcp__server__action
 * drops its server; a bare built-in like Bash stays as it is. */
function actionTokens(name: string): string[] {
  let action = name;
  if (name.startsWith("mcp__")) {
    const [, server = "", ...rest] = name.split("__");
    action = rest.join("_");
    if (server === "composio") return actionTokens(action);
  } else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name)) {
    action = name.slice(name.indexOf("_") + 1);
  }
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Does the tool name describe a read-only action? This is deliberately
 * narrower than "not outbound": updates, deletes and other writes do not
 * become reads merely because they send nothing to another person. */
export function isReadOnlyTool(name: string): boolean {
  const tokens = actionTokens(name);
  return tokens.length > 0 && READ_VERBS.has(tokens[0]);
}

/** Does this tool send something to someone, or move money? */
export function isOutboundTool(name: string): boolean {
  // A raw API call from the workbench can do anything an app tool can, and
  // nothing here can read which; it is treated as a send.
  if (name === "COMPOSIO_PROXY_EXECUTE") return true;
  const tokens = actionTokens(name);
  if (tokens.length === 0) return false;
  if (isReadOnlyTool(name)) return false;
  if (tokens.some((token) => SEND_VERBS.has(token))) return true;
  if (tokens.includes("DRAFT")) return false;
  return tokens.some((token) => CREATE_VERBS.has(token)) && tokens.some((token) => SENT_NOUNS.has(token));
}

/** The stored shape, or null when the value is not one. */
export function normalizeOutboundPolicy(value: unknown): OutboundPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { policy, dailyCap } = value as { policy?: unknown; dailyCap?: unknown };
  if (policy !== "ask" && policy !== "allow") return null;
  if (dailyCap === undefined) return { policy, dailyCap: OUTBOUND_DEFAULT_CAP };
  if (typeof dailyCap !== "number" || !Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > OUTBOUND_MAX_CAP) return null;
  return { policy, dailyCap };
}

/** What a bot without a stored policy does: ask, every time. */
export const DEFAULT_OUTBOUND_POLICY: OutboundPolicy = { policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP };

/** One app tool a connector request would run, with its arguments when the
 * request carries them. */
export interface ConnectorCall {
  slug: string;
  arguments?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Fork: modules a read-only workbench script may import. Nothing here opens
// a connection or starts a process.
const WORKBENCH_SAFE_MODULES = new Set([
  "json", "re", "datetime", "time", "math", "statistics", "collections", "itertools",
  "html", "textwrap", "csv", "base64", "unicodedata", "zoneinfo", "decimal",
]);
// Names that reach outside the sandbox or hide what is called: network and
// process modules, dynamic execution, attribute lookup by string, private
// attributes, and Composio helpers other than run_composio_tool. Any '#' is
// refused: a comment inside brackets can split '.' from '_x'. Non-ASCII
// is refused outright: Python NFKC-folds identifiers (ｅｘｅｃ is exec).
const WORKBENCH_UNSAFE = /\b(?:exec|eval|compile|getattr|setattr|delattr|globals|locals|vars|breakpoint|proxy_execute|upload_local_file|execute_tool|run_tool|requests|urllib|httpx?|aiohttp|socket|subprocess|popen|system|smtplib|ftplib|ctypes|composio|os|sys|modules|builtins|importlib|shutil|pty|signal|spawn\w*|multiprocessing|threading|asyncio|ssl|attrgetter|methodcaller|get_type_hints|ForwardRef|Formatter|get_field|reduce)\b|__\w+__|\.\s*(?:\\\s*)?_|[^\t\n\r -~]|#|\w*execute\w*\s*\(/i;
const WORKBENCH_TOOL_CALL = /\brun_composio_tool\b/g;
const WORKBENCH_LITERAL_CALL = /\brun_composio_tool\s*\(\s*(?:tool_slug\s*=\s*)?["']([A-Z][A-Z0-9_]*)["']/g;

/** Fork: the app tools a workbench script runs, when it provably only reads:
 * every run_composio_tool call names a literal read-only tool, it imports
 * only safe modules, and nothing in it can reach the network, run a process
 * or compute a call. Null otherwise; the caller then treats it as opaque.
 * A heuristic over source text: anything it cannot see through fails closed. */
export function readOnlyWorkbenchCalls(code: unknown): ConnectorCall[] | null {
  if (typeof code !== "string" || !code.trim()) return null;
  // proxy_execute etc. are caught by WORKBENCH_UNSAFE; run_composio_tool is
  // the one helper allowed, so mask it before that check.
  if (WORKBENCH_UNSAFE.test(code.replace(WORKBENCH_TOOL_CALL, "tool_call"))) return null;
  // Every import must be its own line, so the allowlist below sees them all.
  let importLines = 0;
  for (const line of code.split("\n")) {
    const imported = line.match(/^\s*(?:from\s+([\w.]+)\s+import\b|import\s+(.+))/);
    if (!imported) continue;
    importLines++;
    if (/[;\\]/.test(line)) return null;
    const modules = imported[1] ? [imported[1]] : imported[2].split(",").map((part) => part.trim().split(/\s+/)[0]);
    if (!modules.every((module) => WORKBENCH_SAFE_MODULES.has(module.split(".")[0]))) return null;
  }
  if ((code.match(/\bimport\b/g) ?? []).length !== importLines) return null;
  const slugs = [...code.matchAll(WORKBENCH_LITERAL_CALL)].map((match) => match[1]);
  if (slugs.length !== (code.match(WORKBENCH_TOOL_CALL) ?? []).length) return null;
  if (!slugs.every((slug) => isReadOnlyTool(slug) && !isOutboundTool(slug))) return null;
  return [...new Set(slugs)].map((slug) => ({ slug }));
}

/** Composio's session exposes a handful of meta tools and runs the app
 * tools inside them: a multi-execute call carries a list of slugs with
 * arguments. Arbitrary workbench/bash code is opaque: it requires an
 * explicit unrestricted approval, never an inferred app or send count.
 * Search, schema lookup, and connection management run no app tools. */
export function connectorCallsIn(name: string, args: unknown): ConnectorCall[] {
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = isRecord(args) && Array.isArray(args.tools) ? args.tools
      : isRecord(args) && typeof args.tool_slug === "string" ? [args] : [];
    if (!tools.length) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
    const calls: ConnectorCall[] = [];
    for (const item of tools) {
      if (!isRecord(item)) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      const slug = [item.tool_slug, item.slug, item.name, item.tool].find((value) => typeof value === "string" && value);
      if (typeof slug !== "string") return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      calls.push({ slug, ...(item.arguments !== undefined ? { arguments: item.arguments } : {}) });
    }
    return calls;
  }
  if (name === "COMPOSIO_REMOTE_WORKBENCH") {
    // Fork: a script that provably only reads runs without a card.
    const reads = readOnlyWorkbenchCalls(isRecord(args) ? args.code_to_execute ?? args.code : undefined);
    if (reads) return reads;
  }
  if (name === "COMPOSIO_REMOTE_WORKBENCH" || name === "COMPOSIO_REMOTE_BASH_TOOL") {
    // Arbitrary code can compute tool names and repeat calls. Its app and
    // outbound count cannot be inferred from literals in the source.
    return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  }
  if (["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"].includes(name)) return [];
  if (name.startsWith("COMPOSIO_")) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  return [{ slug: name, ...(args !== undefined ? { arguments: args } : {}) }];
}

/** The subset of a request's app tools that would send something. */
export function outboundCallsIn(name: string, args: unknown): ConnectorCall[] {
  return connectorCallsIn(name, args).filter((call) => isOutboundTool(call.slug));
}
