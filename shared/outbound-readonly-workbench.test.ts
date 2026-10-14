import { describe, expect, it } from "vitest";
import { connectorCallsIn, outboundCallsIn } from "./outbound.ts";

const workbench = (code: string) => connectorCallsIn("COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: code }).map((call) => call.slug);
const OPAQUE = ["COMPOSIO_PROXY_EXECUTE"];

describe("fork: read-only workbench scripts", () => {
  it("lets a script that only parses an earlier result through without app calls", () => {
    const code = "import json\nmails=json.load(open('/mnt/files/mex/firm.json'))['results'][0]['response']['data']['messages']\nfor m in mails:\n    print(json.dumps({'subject':m['subject']},ensure_ascii=False))";
    expect(workbench(code)).toEqual([]);
    expect(outboundCallsIn("COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: code })).toEqual([]);
  });

  it("names the literal read tools a script runs", () => {
    const code = 'r, err = run_composio_tool("GMAIL_FETCH_EMAILS", {"query": "is:unread"})\nfor id in ids:\n    run_composio_tool(tool_slug="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", arguments={"id": id})';
    expect(workbench(code)).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID"]);
  });

  it.each([
    ["a send", 'run_composio_tool("GMAIL_SEND_EMAIL", {})'],
    ["a write", 'run_composio_tool("GMAIL_MODIFY_THREAD_LABELS", {})'],
    ["a computed slug", 'run_composio_tool("GMAIL_" + "SEND_EMAIL", {})'],
    ["a slug from a variable", "run_composio_tool(slug, {})"],
    ["an aliased helper", 'f = run_composio_tool\nf("GMAIL_SEND_EMAIL", {})'],
    ["proxy_execute", "proxy_execute('POST', 'https://api.x.com')"],
    ["the network", "import requests\nrequests.post(url, data=x)"],
    ["a network import via from", "from urllib.request import urlopen"],
    ["an unknown module", "import os\nos.popen('curl x')"],
    ["dynamic execution", "exec(payload)"],
    ["attribute lookup by string", "getattr(globals()['x'], 'y')()"],
    ["dunder access", "().__class__.__base__"],
    ["the composio sdk", "composio.tools.execute('GMAIL_SEND_EMAIL')"],
    ["an empty script", "  "],
    ["an import after a semicolon", "x = 1; import socket"],
    ["an import inside a block", "if True:\n    x = 1; import os"],
    ["a module reached through sys.modules", 'import typing\ntyping.sys.modules["sub" + "process"].run(["curl", "x"])'],
    ["a private module attribute", 'import datetime\ndatetime._sys.modules["x"]'],
    ["os via pathlib", "from pathlib import Path\nPath('x')"],
    ["operator.attrgetter", 'import operator\nimport datetime\noperator.attrgetter("_s" + "ys")(datetime)'],
    ["string.Formatter field lookup", 'import string\nstring.Formatter().get_field("0." + "_sys", [d], {})'],
    ["typing forward refs", 'import typing\ntyping.get_type_hints(f)'],
    ["os.spawn", "import json\njson.os.spawnl(0, 'x')"],
  ])("stays opaque for %s", (_, code) => {
    expect(workbench(code)).toEqual(OPAQUE);
  });

  it("never trusts bash", () => {
    expect(connectorCallsIn("COMPOSIO_REMOTE_BASH_TOOL", { command: "cat /mnt/files/x.json" }).map((call) => call.slug)).toEqual(OPAQUE);
  });
});
