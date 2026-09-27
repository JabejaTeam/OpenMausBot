// The WhatsApp archive as a stdio MCP server, mounted like any custom server:
//   { "command": "<node>", "args": ["<dist-server>/whatsapp-mcp.js"],
//     "env": { "WA_ARCHIVE_DIR": "…", "SONIOX_API_KEY": "…" } }
// The tools live in whatsapp-tools.ts; this file only speaks the protocol.
import { createInterface } from "node:readline";

import { createWhatsAppTools, handleWhatsAppMcp } from "./whatsapp-tools.ts";

const dir = process.env.WA_ARCHIVE_DIR ?? "";
if (!dir) {
  process.stderr.write("WA_ARCHIVE_DIR is not set\n");
  process.exit(2);
}
const tools = createWhatsAppTools({ dir, sonioxKey: process.env.SONIOX_API_KEY || undefined });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let request: Record<string, unknown>;
  try {
    request = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  void handleWhatsAppMcp(tools, request).then((response) => {
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
});
