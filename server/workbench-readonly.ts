// Fork: a Composio workbench script that provably only reads runs without
// the "Send on your behalf?" card. Python itself parses the script (ast) and
// a whitelist decides: allowed syntax, names that are builtins from a short
// list, assigned in the script or imported from a few data modules, no
// private or frame attributes, modules only ever used as `module.function`,
// and run_composio_tool only with a literal read-only tool name. Anything
// else, or any failure to check, keeps the card.

import { execFile } from "node:child_process";
import { isOutboundTool, isReadOnlyTool, type ConnectorCall } from "../shared/outbound.ts";

const CHECKER = String.raw`
import ast, importlib, inspect, json, sys

SAFE_MODULES = {"json", "re", "datetime", "time", "math", "statistics", "collections", "itertools",
                "html", "textwrap", "csv", "base64", "unicodedata", "zoneinfo", "decimal"}
SAFE_BUILTINS = {"print", "len", "range", "enumerate", "zip", "sorted", "reversed", "min", "max", "sum",
                 "any", "all", "abs", "round", "int", "float", "str", "bool", "bytes", "list", "dict",
                 "set", "tuple", "frozenset", "isinstance", "map", "filter", "open", "repr", "chr", "ord",
                 "divmod", "iter", "next", "Exception", "ValueError", "KeyError", "TypeError",
                 "IndexError", "AttributeError", "StopIteration", "None", "True", "False"}
# Composio workbench helpers that read or think; run_composio_tool is checked per call.
SAFE_HELPERS = {"invoke_llm", "smart_file_extract"}
TOOL = "run_composio_tool"
NODES = (ast.Module, ast.Expr, ast.Assign, ast.AugAssign, ast.AnnAssign, ast.For, ast.While, ast.If,
         ast.Break, ast.Continue, ast.Pass, ast.Try, ast.ExceptHandler, ast.With, ast.withitem,
         ast.FunctionDef, ast.Lambda, ast.Return, ast.arguments, ast.arg, ast.Import, ast.ImportFrom,
         ast.alias, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.IfExp, ast.Dict, ast.Set, ast.List,
         ast.Tuple, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.comprehension,
         ast.Compare, ast.Call, ast.keyword, ast.Constant, ast.JoinedStr, ast.FormattedValue, ast.Name,
         ast.Attribute, ast.Subscript, ast.Slice, ast.Starred, ast.Load, ast.Store, ast.Del,
         ast.operator, ast.cmpop, ast.boolop, ast.unaryop, ast.Raise, ast.Assert, ast.Delete, ast.NamedExpr)
# Attributes that reach frames, code or the import machinery without a leading underscore.
BAD_ATTR_PREFIXES = ("gi_", "cr_", "ag_", "f_", "tb_", "co_")
BAD_ATTRS = {"mro", "format", "format_map", "load_module", "find_spec", "loader", "modules"}

def fail():
    print("null"); sys.exit(0)

try:
    tree = ast.parse(sys.stdin.read())
except Exception:
    fail()

modules, assigned, slugs = {}, set(), []
for node in ast.walk(tree):
    if not isinstance(node, NODES):
        fail()
    if isinstance(node, ast.Import):
        for alias in node.names:
            if alias.name not in SAFE_MODULES: fail()
            modules[alias.asname or alias.name] = importlib.import_module(alias.name)
    elif isinstance(node, ast.ImportFrom):
        if node.level or node.module not in SAFE_MODULES: fail()
        mod = importlib.import_module(node.module)
        for alias in node.names:
            if alias.name == "*" or alias.name.startswith("_"): fail()
            value = getattr(mod, alias.name, None)
            if value is None or inspect.ismodule(value): fail()
            assigned.add(alias.asname or alias.name)
    elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        assigned.add(node.id)
    elif isinstance(node, ast.arg):
        assigned.add(node.arg)
    elif isinstance(node, ast.FunctionDef):
        if node.decorator_list: fail()
        assigned.add(node.name)
    elif isinstance(node, ast.ExceptHandler) and node.name:
        assigned.add(node.name)

parents = {}
for node in ast.walk(tree):
    for child in ast.iter_child_nodes(node):
        parents[child] = node

for node in ast.walk(tree):
    if isinstance(node, ast.Attribute):
        if node.attr.startswith("_") or node.attr.startswith(BAD_ATTR_PREFIXES) or node.attr in BAD_ATTRS: fail()
        if isinstance(node.value, ast.Name) and node.value.id in modules:
            value = getattr(modules[node.value.id], node.attr, None)
            if value is None or inspect.ismodule(value): fail()
    elif isinstance(node, ast.Name):
        name = node.id
        if name.startswith("_"): fail()
        if name in modules:
            # A module is only ever the left side of module.attribute.
            parent = parents.get(node)
            if name in assigned or not (isinstance(parent, ast.Attribute) and parent.value is node): fail()
            continue
        if name == TOOL:
            parent = parents.get(node)
            if name in assigned or not (isinstance(parent, ast.Call) and parent.func is node): fail()
            slug = parent.args[0] if parent.args else next((k.value for k in parent.keywords if k.arg == "tool_slug"), None)
            if not (isinstance(slug, ast.Constant) and isinstance(slug.value, str)): fail()
            slugs.append(slug.value)
            continue
        if name not in assigned and name not in SAFE_BUILTINS and name not in SAFE_HELPERS: fail()

print(json.dumps(slugs))
`;

const TIMEOUT_MS = 5_000;

/** The app tools a workbench script runs when it provably only reads, or
 * null: the caller then treats it as opaque code and asks. */
export async function readOnlyWorkbenchCalls(code: unknown): Promise<ConnectorCall[] | null> {
  if (typeof code !== "string" || !code.trim()) return null;
  const output = await new Promise<string | null>((resolve) => {
    const child = execFile("python3", ["-I", "-c", CHECKER], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => resolve(error ? null : stdout));
    child.stdin?.on("error", () => resolve(null));
    child.stdin?.end(code);
  });
  let slugs: unknown;
  try {
    slugs = output === null ? null : JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(slugs) || !slugs.every((slug) => typeof slug === "string")) return null;
  if (!slugs.every((slug) => /^[A-Z][A-Z0-9_]*$/.test(slug) && isReadOnlyTool(slug) && !isOutboundTool(slug))) return null;
  return [...new Set(slugs)].map((slug) => ({ slug }));
}
