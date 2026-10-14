import { describe, expect, it } from "vitest";
import { readOnlyWorkbenchCalls } from "./workbench-readonly.ts";

const slugs = async (code: string) => (await readOnlyWorkbenchCalls(code))?.map((call) => call.slug) ?? null;

describe("fork: read-only workbench scripts (python ast)", () => {
  it("passes a script that only parses an earlier result", async () => {
    const code = "import json\nmails=json.load(open('/mnt/files/mex/firm.json'))['results'][0]['response']['data']['messages']\nfor m in mails:\n    print(json.dumps({'subject':m['subject'],'text':m['messageText'][:18000]},ensure_ascii=False))";
    expect(await slugs(code)).toEqual([]);
  });

  it("passes comments, non-ASCII strings, functions and comprehensions", async () => {
    const code = "# één samenvatting\nfrom datetime import datetime\ndef short(t):\n    return t[:80]\ndata = []\nrows = [short(m['subject']) for m in data if m]\nwith open('/mnt/files/x.json') as f:\n    raw = f.read()\nprint(f\"{len(rows)} mails – {datetime.now():%H:%M}\")";
    expect(await slugs(code)).toEqual([]);
  });

  it("names the literal read tools a script runs", async () => {
    const code = 'r = run_composio_tool("GMAIL_FETCH_EMAILS", {"query": "is:unread"})\nids = ["a"]\nfor i in ids:\n    run_composio_tool(tool_slug="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", arguments={"id": i})';
    expect(await slugs(code)).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID"]);
  });

  it.each([
    ["a send", 'run_composio_tool("GMAIL_SEND_EMAIL", {})'],
    ["a write", 'run_composio_tool("GMAIL_MODIFY_THREAD_LABELS", {})'],
    ["a computed slug", 'run_composio_tool("GMAIL_" + "SEND_EMAIL", {})'],
    ["an aliased helper", 'f = run_composio_tool\nf("GMAIL_SEND_EMAIL", {})'],
    ["proxy_execute", "proxy_execute('POST', 'https://api.x.com')"],
    ["an unknown helper", "send_email(to='x')"],
    ["the network", "import requests\nrequests.post(url, data=x)"],
    ["a network import via from", "from urllib.request import urlopen"],
    ["os", "import os\nos.popen('curl x')"],
    ["exec", "exec(payload)"],
    ["getattr", "getattr(x, 'y')"],
    ["dunder access", "x = ()\nx.__class__"],
    ["a private module attribute", "import datetime\ndatetime._sys"],
    ["a private attribute split by a comment", "import datetime\n(datetime. # x\n _sys)"],
    ["a module reached through a module", "import json\njson.codecs.open('x', 'w')"],
    ["a module passed around", "import json\nm = json\nm.codecs"],
    ["a module imported by name", "from json import decoder"],
    ["frames via a generator", "g = (x for x in [1])\ng.gi_frame.f_globals"],
    ["str.format field lookups", "x = '{0.y}'\nx.format(1)"],
    ["a class", "class A: pass"],
    ["a decorator", "def d(f): return f\n@d\ndef g(): pass"],
    ["fullwidth exec", "ｅｘｅｃ(payload)"],
    ["a syntax error", "def ("],
    ["a builtin shadowed only on a branch that never runs", "if False:\n    exec = print\nexec(payload)"],
    ["a workbench global reached past a dead binding", "if False:\n    send_email = print\nsend_email(to='x')"],
    ["a name bound only inside a loop", "for x in []:\n    proxy = 1\nproxy('POST')"],
    ["a name bound only inside try", "try:\n    helper = print\nexcept Exception:\n    pass\nhelper()"],
    ["del", "x = 1\ndel x"],
    ["shadowing a safe builtin", "print = 1"],
    ["a function using a later global", "def f():\n    return later()\nlater = print\nf()"],
    ["open for writing", "open('/tmp/x', 'w')"],
    ["open passed around", "o = open\no('/tmp/x', 'w')"],
    ["an import inside a block", "if True:\n    import json"],
    ["walrus", "if (x := 1):\n    pass"],
    ["an empty script", "  "],
  ])("stays opaque for %s", async (_, code) => {
    expect(await readOnlyWorkbenchCalls(code)).toBeNull();
  });
});
