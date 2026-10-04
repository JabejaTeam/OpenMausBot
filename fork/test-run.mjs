#!/usr/bin/env node
// Jabeja fork only: run the vitest suite (or --files a b …) on every core of
// this machine. Files are packed into jobs by their measured duration, and a
// file longer than one job is split into slices of its tests, picked by exact
// name (-t) so the rest are never collected and their hooks never run; tests
// not measured yet fall into the first slice. A queue runs the jobs longest first, so no worker
// idles while another works through a long tail. Failed tests are then rerun
// on their own, in parallel: a pass there is reported as flaky, a second
// failure as real — unless the whole file then passes: its tests lean on each
// other's state, so it is remembered as order-dependent and never sliced
// again. Durations and that list are kept in OMB_TEST_DURATIONS between runs.
//   node fork/test-run.mjs [--workers N] [--files <test files…>]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
// All cores: measured on the beast, 32 workers beat 24 (83s against 94s).
const workers = Number(option("--workers", availableParallelism()));
const listed = args.includes("--files") ? args.slice(args.indexOf("--files") + 1) : [];
const root = process.cwd();
const dbPath = process.env.OMB_TEST_DURATIONS ?? join(root, "node_modules/.cache/omb-test-durations.json");
const out = mkdtempSync(join(tmpdir(), "omb-test-run-"));
const vitest = join(root, "node_modules/.bin/vitest");
const started = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const phases = [];
const phase = (name, since) => phases.push(`${name} ${secs(Date.now() - since)}`);

// ── what to run ──
let since = Date.now();
let files = listed;
if (!files.length) {
  execFileSync(vitest, ["list", "--filesOnly", `--json=${out}/files.json`], { stdio: "ignore" });
  files = JSON.parse(readFileSync(`${out}/files.json`, "utf8")).map((entry) => relative(root, entry.file));
}
const db = { files: {}, tests: {}, whole: {}, perFile: 150, perJob: 2_000,
  ...(existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, "utf8")) : {}) };
const known = Object.values(db.files).sort((a, b) => a - b);
const fallback = known.length ? known[Math.floor(known.length / 2)] : 3000;
// What a file costs a job: its tests, plus collecting it (import, transform).
const estimate = (file) => (db.files[file] ?? fallback) + db.perFile;
const total = files.reduce((sum, file) => sum + estimate(file), 0);
// Short jobs keep the queue even: a quarter of one worker's fair share, but a
// few seconds at least so vitest's own startup stays a small part of each.
const target = Math.max(5_000, total / workers / 4);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** -t for exactly these tests; with `rest`, for every test except these. */
const pattern = (names, rest = false) => {
  const any = `(?:${names.map(escape).join("|")})`;
  return rest ? `^(?!${any}$)` : `^${any}$`;
};

const jobs = [];
const small = [];
for (const file of files) {
  const ms = estimate(file);
  if (ms <= target) { small.push(file); continue; }
  if (db.whole[file]) { jobs.push({ files: [file], ms }); continue; }
  const of = Math.ceil(ms / target);
  const bins = Array.from({ length: of }, () => 0);
  const assign = {};
  for (const [test, testMs] of Object.entries(db.tests[file] ?? {}).sort((a, b) => b[1] - a[1])) {
    const slice = bins.indexOf(Math.min(...bins));
    assign[test] = slice;
    bins[slice] += testMs;
  }
  const named = (slice) => Object.keys(assign).filter((test) => assign[test] === slice);
  const others = Object.keys(assign).filter((test) => assign[test] !== 0);
  // An unmeasured file cannot be split by name: it runs whole once, and is measured.
  if (!others.length) { jobs.push({ files: [file], ms }); continue; }
  for (let slice = 0; slice < of; slice++) {
    if (slice > 0 && !named(slice).length) continue;
    jobs.push({ files: [file], filter: slice === 0 ? pattern(others, true) : pattern(named(slice)), label: `${slice + 1}/${of}`, ms: ms / of });
  }
}
// First fit, longest first: few processes, none longer than the target.
const packed = [];
for (const file of small.sort((a, b) => estimate(b) - estimate(a))) {
  const job = packed.find((candidate) => candidate.ms + estimate(file) <= target);
  if (job) { job.files.push(file); job.ms += estimate(file); } else packed.push({ files: [file], ms: db.perJob + estimate(file) });
}
jobs.push(...packed);
jobs.sort((a, b) => b.ms - a.ms);
phase("plan", since);

// ── a queue of vitest processes ──
let serial = 0;
function run(job) {
  const id = ++serial;
  const log = openSync(`${out}/job-${id}.log`, "w");
  const begun = Date.now();
  return new Promise((resolve) => {
    const child = spawn(vitest, ["run", "--reporter=json", `--outputFile=${out}/job-${id}.json`, "--passWithNoTests",
      ...(job.filter ? ["-t", job.filter] : []), ...job.files], { stdio: ["ignore", log, log] });
    child.on("close", (code) => resolve({ job, id, code, ms: Date.now() - begun }));
  });
}
async function pool(list, size, label) {
  const results = [];
  let next = 0;
  let done = 0;
  const report = setInterval(() => console.log(`${label}: ${done}/${list.length} jobs done, ${secs(Date.now() - started)}`), 15_000);
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) {
      results.push(await run(list[next++]));
      done++;
    }
  }));
  clearInterval(report);
  return results;
}
/** Per file: its duration, its tests' durations, and what failed. A job that
 * left no report crashed, and every file in it counts as failed whole. */
function read(results) {
  const files = new Map();
  for (const { job, id } of results) {
    const path = `${out}/job-${id}.json`;
    const report = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    if (!report) {
      for (const file of job.files) files.set(file, { ms: 0, tests: {}, failed: null, crashed: id });
      continue;
    }
    for (const result of report.testResults) {
      const file = relative(root, result.name);
      const entry = files.get(file) ?? { ms: 0, tests: {}, failed: [] };
      entry.ms += Math.max(0, result.endTime - result.startTime);
      for (const test of result.assertionResults) {
        const key = test.fullName;
        if (test.status === "passed" || test.status === "failed") entry.tests[key] = test.duration ?? 0;
        if (test.status === "failed") entry.failed?.push({ key, message: test.failureMessages.join("\n") });
      }
      // A file that failed outside any test (import, beforeAll) reruns whole.
      if (result.status === "failed" && entry.failed?.length === 0) { entry.failed = null; entry.message = result.message; }
      files.set(file, entry);
    }
  }
  return files;
}
const failures = (files) => [...files].filter(([, entry]) => entry.failed === null || entry.failed.length);

since = Date.now();
const first = await pool(jobs, workers, "suite");
const runWall = Date.now() - since;
phase("suite", since);
const measured = read(first);
for (const [file, entry] of measured) {
  if (entry.crashed) continue;
  db.files[file] = entry.ms;
  db.tests[file] = { ...db.tests[file], ...entry.tests };
}
// Overheads, from the jobs themselves: a job of one file shows vitest's own
// startup; a job of many files shows what each file costs beyond its tests.
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const spent = (result) => result.job.files.reduce((sum, file) => sum + (measured.get(file)?.ms ?? 0), 0);
const singles = first.filter((result) => result.job.files.length === 1 && !result.job.filter).map((result) => result.ms - spent(result));
if (singles.length) db.perJob = Math.max(0, median(singles));
const many = first.filter((result) => result.job.files.length >= 10).map((result) => (result.ms - spent(result) - db.perJob) / result.job.files.length);
if (many.length) db.perFile = Math.max(0, median(many));
mkdirSync(dirname(dbPath), { recursive: true });
writeFileSync(dbPath, JSON.stringify(db));

// ── reruns: only what failed, each file alone, all at once; what still
// fails runs once more as a whole file ──
since = Date.now();
const failed = failures(measured);
const reruns = failed.map(([file, entry]) => ({ files: [file], ...(entry.failed ? { filter: pattern(entry.failed.map((f) => f.key)) } : {}) }));
const second = reruns.length ? read(await pool(reruns, workers, "rerun")) : new Map();
// Only a file that ran in slices can have failed for that reason.
const sliced = new Set(jobs.filter((job) => job.label).map((job) => job.files[0]));
const wholeRuns = failures(second).filter(([file]) => sliced.has(file)).map(([file]) => ({ files: [file] }));
const third = wholeRuns.length ? read(await pool(wholeRuns, workers, "whole-file rerun")) : new Map();
if (reruns.length) phase("rerun", since);
const real = failures(second).filter(([file]) => !third.has(file) || failures(third).some(([again]) => again === file))
  .map(([file, entry]) => [file, third.get(file) ?? entry]);
const orderDependent = wholeRuns.map((job) => job.files[0]).filter((file) => !real.some(([again]) => again === file));
for (const file of orderDependent) db.whole[file] = true;
if (orderDependent.length) writeFileSync(dbPath, JSON.stringify(db));
const flaky = failed.map(([file]) => file).filter((file) => !real.some(([again]) => again === file) && !orderDependent.includes(file));

// ── report ──
const busy = first.reduce((sum, result) => sum + result.ms, 0);
const counts = [...measured].reduce((sum, [file, entry]) => sum + Object.keys({ ...entry.tests, ...second.get(file)?.tests, ...third.get(file)?.tests }).length, 0);
console.log(`\n${files.length} files, ${counts} tests, ${jobs.length} jobs on ${workers} workers (target ${secs(target)} per job)`);
console.log(`phases: ${phases.join(", ")}; total ${secs(Date.now() - started)}`);
console.log(`overhead: ${secs(db.perJob)} per job, ${secs(db.perFile)} per file`);
console.log(`workers busy ${Math.round((busy / (workers * runWall)) * 100)}% of the suite phase`);
console.log(`slowest jobs: ${first.sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => `${secs(r.ms)} ${r.job.files.length > 1 ? `${r.job.files.length} files` : r.job.files[0]}${r.job.label ? ` [${r.job.label}]` : ""}`).join(", ")}`);
if (flaky.length) console.log(`FLAKY under parallel load (passed alone): ${flaky.join(" ")}`);
if (orderDependent.length) console.log(`ORDER-DEPENDENT (failed alone, passed as a whole file; no longer sliced): ${orderDependent.join(" ")}`);
for (const [file, entry] of real) {
  console.log(`\nFAIL ${file}${entry.crashed ? ` (crashed, see ${out}/job-${entry.crashed}.log)` : ""}`);
  for (const test of entry.failed ?? [{ key: "(file)", message: entry.message ?? "" }]) console.log(`  × ${test.key}\n${test.message.split("\n").slice(0, 12).map((line) => `    ${line}`).join("\n")}`);
}
console.log(real.length ? `\n${real.length} file(s) failed; logs in ${out}` : "\nall green");
process.exit(real.length ? 1 : 0);
