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
                 "set", "tuple", "frozenset", "isinstance", "map", "filter", "repr", "chr", "ord",
                 "divmod", "iter", "next", "Exception", "ValueError", "KeyError", "TypeError",
                 "IndexError", "AttributeError", "StopIteration"}
# Composio workbench helpers that read or think; run_composio_tool is checked per call.
SAFE_HELPERS = {"invoke_llm", "smart_file_extract"}
TOOL = "run_composio_tool"
FIXED = SAFE_BUILTINS | SAFE_HELPERS | {TOOL, "open"}
# Attributes that reach frames, code or the import machinery without a leading underscore.
BAD_ATTR_PREFIXES = ("gi_", "cr_", "ag_", "f_", "tb_", "co_")
BAD_ATTRS = {"mro", "format", "format_map", "load_module", "find_spec", "loader", "modules"}
EXPR = (ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.IfExp, ast.Dict, ast.Set, ast.List, ast.Tuple,
        ast.Compare, ast.Call, ast.keyword, ast.Constant, ast.JoinedStr, ast.FormattedValue,
        ast.Subscript, ast.Slice, ast.Starred, ast.Load, ast.Store,
        ast.operator, ast.cmpop, ast.boolop, ast.unaryop)

class Fail(Exception):
    pass

def fail():
    raise Fail()

modules, slugs = {}, []

# Names are flow-sensitive: a name is usable only after a binding that
# certainly ran, in the same or an enclosing scope. A binding inside an if,
# loop, while or try body is not visible after that block, so a name never
# silently falls back to a builtin or a workbench global.

def bind(target, bound):
    if isinstance(target, ast.Name):
        if target.id.startswith("_") or target.id in modules or target.id in FIXED: fail()
        bound.add(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for item in target.elts: bind(item, bound)
    elif isinstance(target, ast.Starred):
        bind(target.value, bound)
    elif isinstance(target, (ast.Subscript, ast.Attribute)):
        expr(target, bound)
    else:
        fail()

def attribute(node, bound):
    if node.attr.startswith("_") or node.attr.startswith(BAD_ATTR_PREFIXES) or node.attr in BAD_ATTRS: fail()
    if isinstance(node.value, ast.Name) and node.value.id in modules:
        value = getattr(modules[node.value.id], node.attr, None)
        if value is None or inspect.ismodule(value): fail()
        return
    expr(node.value, bound)

def call(node, bound):
    func = node.func
    if isinstance(func, ast.Name) and func.id in (TOOL, "open") and any(isinstance(a, ast.Starred) for a in node.args): fail()
    if isinstance(func, ast.Name) and func.id == TOOL:
        slug = node.args[0] if node.args else next((k.value for k in node.keywords if k.arg == "tool_slug"), None)
        if not (isinstance(slug, ast.Constant) and isinstance(slug.value, str)): fail()
        slugs.append(slug.value)
    elif isinstance(func, ast.Name) and func.id == "open":
        if len(node.args) > 2 or any(k.arg not in ("file", "mode", "encoding", "errors", "newline") for k in node.keywords): fail()
        mode = node.args[1] if len(node.args) > 1 else next((k.value for k in node.keywords if k.arg == "mode"), None)
        if mode is not None and not (isinstance(mode, ast.Constant) and mode.value in ("r", "rb")): fail()
    else:
        expr(func, bound)
    for arg in node.args: expr(arg, bound)
    for keyword in node.keywords:
        if keyword.arg is None: fail()
        expr(keyword.value, bound)

def comprehension(node, bound):
    inner = set(bound)
    for gen in node.generators:
        if gen.is_async: fail()
        expr(gen.iter, inner)
        bind(gen.target, inner)
        for cond in gen.ifs: expr(cond, inner)
    if isinstance(node, ast.DictComp):
        expr(node.key, inner); expr(node.value, inner)
    else:
        expr(node.elt, inner)

def arguments(args, bound):
    if args.posonlyargs or args.vararg or args.kwonlyargs or args.kwarg: fail()
    for default in args.defaults: expr(default, bound)
    inner = set(bound)
    for arg in args.args:
        if arg.annotation is not None: fail()
        bind(ast.Name(id=arg.arg, ctx=ast.Store()), inner)
    return inner

def expr(node, bound):
    if node is None: return
    if isinstance(node, ast.Name):
        if isinstance(node.ctx, ast.Load):
            if node.id in modules or node.id in (TOOL, "open"): fail()  # only as module.attr / direct call
            if node.id not in bound and node.id not in SAFE_BUILTINS and node.id not in SAFE_HELPERS: fail()
        else:
            fail()
    elif isinstance(node, ast.Attribute):
        attribute(node, bound)
    elif isinstance(node, ast.Call):
        call(node, bound)
    elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
        comprehension(node, bound)
    elif isinstance(node, ast.Lambda):
        expr(node.body, arguments(node.args, bound))
    elif isinstance(node, ast.Constant):
        pass
    elif isinstance(node, EXPR):
        for child in ast.iter_child_nodes(node): expr(child, bound)
    elif isinstance(node, (ast.expr_context, ast.operator, ast.cmpop, ast.boolop, ast.unaryop)):
        pass
    else:
        fail()

def block(statements, bound):
    for node in statements: statement(node, bound)

def statement(node, bound):
    if isinstance(node, ast.Expr):
        expr(node.value, bound)
    elif isinstance(node, ast.Assign):
        expr(node.value, bound)
        for target in node.targets: bind(target, bound)
    elif isinstance(node, ast.AugAssign):
        expr(node.target if not isinstance(node.target, ast.Name) else ast.Name(id=node.target.id, ctx=ast.Load()), bound)
        expr(node.value, bound)
    elif isinstance(node, ast.If):
        expr(node.test, bound)
        block(node.body, set(bound)); block(node.orelse, set(bound))
    elif isinstance(node, (ast.For, ast.While)):
        if isinstance(node, ast.For):
            expr(node.iter, bound)
            inner = set(bound); bind(node.target, inner)
        else:
            expr(node.test, bound); inner = set(bound)
        block(node.body, inner); block(node.orelse, set(bound))
    elif isinstance(node, ast.Try):
        block(node.body, set(bound))
        for handler in node.handlers:
            inner = set(bound)
            expr(handler.type, bound)
            if handler.name: bind(ast.Name(id=handler.name, ctx=ast.Store()), inner)
            block(handler.body, inner)
        block(node.orelse, set(bound)); block(node.finalbody, set(bound))
    elif isinstance(node, ast.With):
        for item in node.items:
            expr(item.context_expr, bound)
            if item.optional_vars is not None: bind(item.optional_vars, bound)
        block(node.body, bound)
    elif isinstance(node, ast.FunctionDef):
        if node.decorator_list or node.returns is not None or getattr(node, "type_params", None): fail()
        inner = arguments(node.args, bound)
        bind(ast.Name(id=node.name, ctx=ast.Store()), bound)
        inner.add(node.name)
        block(node.body, inner)
    elif isinstance(node, ast.Return):
        expr(node.value, bound)
    elif isinstance(node, ast.Raise):
        expr(node.exc, bound); expr(node.cause, bound)
    elif isinstance(node, ast.Assert):
        expr(node.test, bound); expr(node.msg, bound)
    elif isinstance(node, (ast.Pass, ast.Break, ast.Continue)):
        pass
    elif isinstance(node, ast.Import):
        for alias in node.names:
            name = alias.asname or alias.name
            if alias.name not in SAFE_MODULES or "." in name or name in bound or name in FIXED: fail()
            modules[name] = importlib.import_module(alias.name)
    elif isinstance(node, ast.ImportFrom):
        if node.level or node.module not in SAFE_MODULES: fail()
        mod = importlib.import_module(node.module)
        for alias in node.names:
            if alias.name == "*" or alias.name.startswith("_"): fail()
            value = getattr(mod, alias.name, None)
            if value is None or inspect.ismodule(value): fail()
            bind(ast.Name(id=alias.asname or alias.name, ctx=ast.Store()), bound)
    else:
        fail()

try:
    tree = ast.parse(sys.stdin.read())
    # Imports first, so a module name can never also be a variable.
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in SAFE_MODULES: modules[alias.asname or alias.name] = None
    names = set(modules); modules = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)) and node not in tree.body: fail()
    for name in names:
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id == name and not isinstance(node.ctx, ast.Load): fail()
            if isinstance(node, ast.arg) and node.arg == name: fail()
    block(tree.body, set())
except Fail:
    print("null"); sys.exit(0)
except Exception:
    print("null"); sys.exit(0)

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
