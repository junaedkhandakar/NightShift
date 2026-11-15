#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defaultConfigFile, loadConfig } from "./config.mjs";
import { listTasks, paths as makePaths } from "./queue.mjs";
import { parseReport } from "./report.mjs";
import { runSession } from "./runner.mjs";
import { HARNESSES } from "./harness.mjs";
import { buildPullRequestBody, createPullRequest, defaultBranch } from "./pr.mjs";
import { fmtUSD, slug } from "./util.mjs";
import { bold, cyan, gray, green, mark, red, renderTable, section, yellow } from "./term.mjs";

const BOOLEAN = new Set([
  "once",
  "dryRun",
  "force",
  "help",
  "version",
  "all",
  "createPr",
  "draft",
]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-v") {
      out.version = true;
      continue;
    }
    if (arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const [rawKey, inline] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) {
      out[key] = inline;
    } else if (BOOLEAN.has(key)) {
      out[key] = true;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function applyOverrides(cfg, flags) {
  if (typeof flags.harness === "string") cfg.harness = flags.harness;
  if (typeof flags.model === "string") cfg.model = flags.model;
  if (flags.minutes) cfg.limits.minutes = Number(flags.minutes);
  if (flags.maxTurns) cfg.limits.maxTurns = Number(flags.maxTurns);
  if (flags.budget) cfg.limits.budgetUSD = Number(flags.budget);
  if (flags.maxTasks) cfg.limits.maxTasks = Number(flags.maxTasks);
  if (flags.createPr) {
    cfg.pullRequests = { ...(cfg.pullRequests ?? {}), enabled: true };
    if (flags.draft) cfg.pullRequests.draft = true;
    if (typeof flags.base === "string") cfg.pullRequests.base = flags.base;
  }
  return cfg;
}

function help() {
  console.log(`nightshift — overnight supervisor for headless coding agents

Usage:
  nightshift init [--cwd DIR]              scaffold a target repo
  nightshift add "<task title>"            create a task file in the queue
  nightshift list                         show queued, failed, and done tasks
  nightshift run [--once] [--dry-run]      work through tasks/queue/*.md
  nightshift doctor                        check system and agent CLI readiness
  nightshift status                        queue counts + recent report
  nightshift retry <id>                    move tasks/failed/<id>.md back to queue
  nightshift pr <branch>                  open a pull request for a finished branch
  nightshift clean [--all]                 remove worktrees, optionally branches

Flags:
  --cwd DIR          target repo (default: current directory)
  --harness NAME     claude | codex | opencode      (default: from config)
  --model NAME       model passed to the harness
  --minutes N        wall-clock limit per task          (default: 45)
  --max-turns N      harness turn limit                 (default: 60)
  --budget USD       stop the night after this spend    (default: 0 = unlimited)
  --max-tasks N      stop after N tasks                 (default: 0 = whole queue)
  --dry-run          use the built-in dummy harness, spend nothing
  --once             process a single task then exit
  --create-pr        push each finished branch and open a pull request
  --draft            open pull requests as drafts
  --base BRANCH      pull request base branch            (default: repo default)
  -v, --version      print version
  -h, --help         print help
`);
}

async function main() {
  const [command = "run", ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  const cwd = path.resolve(flags.cwd ? String(flags.cwd) : process.cwd());

  if (command === "-h" || command === "--help" || command === "help" || flags.help) return help();
  if (command === "-v" || command === "--version" || command === "version" || flags.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return console.log(pkg.version);
  }

  if (command === "doctor") return doctor(cwd);
  if (command === "init") return init(cwd);
  if (command === "status") return status(cwd);
  if (command === "list" || command === "queue") return list(cwd);
  if (command === "add") return add(cwd, flags);
  if (command === "pr") return pullRequest(cwd, flags);

  if (command === "retry") {
    const id = flags._[0];
    if (!id) throw new Error("usage: nightshift retry <task-id>");
    const cfg = applyOverrides(loadConfig(cwd), flags);
    const P = makePaths(cwd, cfg);
    const src = path.join(P.failed, `${id}.md`);
    if (!existsSync(src)) throw new Error(`no failed task "${id}" in ${P.failed}`);
    mkdirSync(P.queue, { recursive: true });
    renameSync(src, path.join(P.queue, `${id}.md`));
    return console.log(`requeued ${id}`);
  }

  if (command === "clean") {
    const cfg = applyOverrides(loadConfig(cwd), flags);
    const P = makePaths(cwd, cfg);
    const worktrees = existsSync(P.work) ? readdirSync(P.work) : [];
    const { git } = await import("./git.mjs");
    for (const name of worktrees) {
      git(cwd, ["worktree", "remove", "--force", path.join(P.work, name)], { allowFail: true });
    }
    git(cwd, ["worktree", "prune"], { allowFail: true });
    if (flags.all) {
      const branches = (git(cwd, ["branch", "--list", `${cfg.branchPrefix}*`], { allowFail: true }) ?? "")
        .split("\n")
        .map((b) => b.replace(/^[*+]\s*/, "").trim())
        .filter(Boolean);
      for (const branch of branches) git(cwd, ["branch", "-D", branch], { allowFail: true });
      console.log(`removed ${branches.length} branch(es)`);
    }
    return console.log(`pruned ${worktrees.length} worktree(s)`);
  }

  if (command !== "run") throw new Error(`unknown command "${command}" (try: nightshift help)`);

  const cfg = applyOverrides(loadConfig(cwd), flags);
  if (flags.dryRun) console.log("dry run: using the dummy harness, no model calls");
  if (!HARNESSES.includes(cfg.harness) && !flags.dryRun) {
    throw new Error(`unknown harness "${cfg.harness}" (expected: ${HARNESSES.join(", ")})`);
  }

  const result = await runSession({ cwd, cfg, dryRun: Boolean(flags.dryRun), once: Boolean(flags.once) });
  if (result.processed === 0) console.log("nothing to do");
  else console.log(`spent ${fmtUSD(result.state.spentUSD)} in total`);
}

function init(cwd) {
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
  mkdirSync(path.join(cwd, "tasks", "queue"), { recursive: true });

  const configPath = path.join(cwd, "nightshift.config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfigFile(), null, 2) + "\n");
    console.log(`wrote ${configPath}`);
  } else {
    console.log(`kept existing ${configPath}`);
  }

  const example = path.join(cwd, "tasks", "queue", "000-example.md");
  if (!existsSync(example)) {
    writeFileSync(
      example,
      [
        "---",
        "minutes: 20",
        "turns: 30",
        "---",
        "",
        "# Example task: add a health endpoint",
        "",
        "Delete this file once you have written a real task.",
        "",
        "Add `GET /health` returning `{\"ok\":true}` with status 200.",
        "",
        "Acceptance:",
        "- an existing test style is followed",
        "- `npm test` passes",
        "- no new dependencies",
        "",
      ].join("\n"),
    );
    console.log(`wrote ${example}`);
  }

  const gitignore = path.join(cwd, ".gitignore");
  const body = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!body.split(/\r?\n/).includes(".nightshift/")) {
    appendFileSync(gitignore, `${!body || body.endsWith("\n") ? "" : "\n"}.nightshift/\n`);
    console.log("added .nightshift/ to .gitignore");
  }

  console.log(`
Next:
  1. Edit nightshift.config.json — set "gate" to your real check command.
  2. Write small, verifiable tasks in tasks/queue/ (one file per task).
     Quick way: nightshift add "fix the login redirect"
  3. Prove the plumbing:  nightshift run --dry-run --once
  4. Run for real:        nightshift run --once
  5. Read .nightshift/REPORT.md in the morning.
`);
}

/** Create a task file in the queue, ready to be edited. */
function add(cwd, flags) {
  const cfg = loadConfig(cwd);
  const P = makePaths(cwd, cfg);
  const title = flags._.join(" ").trim();

  if (!title) throw new Error('usage: nightshift add "<task title>" [--minutes N] [--body TEXT]');

  const id = slug(title);
  const file = path.join(P.queue, `${id}.md`);
  if (existsSync(file)) throw new Error(`task "${id}" is already in the queue`);

  mkdirSync(P.queue, { recursive: true });

  const minutes = flags.minutes ?? cfg.limits.minutes ?? 45;
  const turns = flags.maxTurns ?? cfg.limits.maxTurns ?? 60;
  const gate = flags.gate ?? (cfg.gate.length === 1 ? cfg.gate[0] : null);
  const body = flags.body ? String(flags.body).trim() : "";

  const lines = ["---", `minutes: ${minutes}`, `turns: ${turns}`];
  if (flags.model) lines.push(`model: ${flags.model}`);
  if (gate) lines.push(`gate: ${gate}`);
  lines.push("---", "", `# ${title}`, "");

  if (body) {
    lines.push(body, "");
  } else {
    lines.push(
      "Describe the outcome and the acceptance criteria.",
      "Be specific: one outcome, a clear definition of done.",
      "",
      "### Acceptance Criteria:",
      "- ",
      "",
    );
  }

  writeFileSync(file, lines.join("\n"));
  console.log(`${green(mark.ok)} wrote ${file}`);
  console.log(
    gray(`  next: edit it, then run "nightshift run --dry-run --once" to prove the plumbing.`),
  );
}

/** Show queued, failed, and finished tasks in readable tables. */
function list(cwd) {
  const cfg = loadConfig(cwd);
  const P = makePaths(cwd, cfg);

  const queued = listTasks(P.queue);
  const failed = listTasks(P.failed);
  const done = listTasks(P.done);
  const entries = parseReport(P.report);

  const latest = (id) => entries.filter((e) => e.id === id).pop() ?? null;
  const short = (text, max = 72) => {
    const value = String(text ?? "").replace(/\s+/g, " ").trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };

  if (!queued.length && !failed.length && !done.length) {
    console.log("Nothing queued yet.");
    console.log(gray('  create one with: nightshift add "fix the login redirect"'));
    return;
  }

  if (queued.length) {
    section(`queue (${queued.length})`);
    console.log(
      renderTable(
        [{ title: "id" }, { title: "minutes" }, { title: "turns" }, { title: "gate" }, { title: "title" }],
        queued.map((t) => [
          t.id,
          t.meta.minutes ?? "-",
          t.meta.turns ?? "-",
          t.meta.gate ?? "-",
          t.title ?? "-",
        ]),
      ),
    );
  }

  if (failed.length) {
    section(`failed (${failed.length})`);
    console.log(
      renderTable(
        [{ title: "id" }, { title: "why" }],
        failed.map((t) => {
          const entry = latest(t.id);
          return [t.id, short(entry?.reason ?? "unknown")];
        }),
      ),
    );
    console.log(gray("  retry with: nightshift retry <id>"));
  }

  if (done.length) {
    section(`done (${done.length})`);
    console.log(
      renderTable(
        [{ title: "id" }, { title: "branch" }, { title: "gate" }],
        done.map((t) => {
          const entry = latest(t.id);
          return [t.id, entry?.branch ?? "-", entry?.gate ?? "-"];
        }),
      ),
    );
  }
}

/** Open a pull request for a branch that already has a finished commit. */
function pullRequest(cwd, flags) {
  const cfg = applyOverrides(loadConfig(cwd), flags);
  const branch = flags._[0];
  if (!branch) throw new Error("usage: nightshift pr <branch>");

  const base = flags.base ?? cfg.pullRequests?.base ?? defaultBranch(cwd);
  const entries = parseReport(path.join(cwd, cfg.paths.report));
  const entry = entries.filter((e) => e.branch === branch).pop() ?? null;
  const id = entry?.id ?? branch.replace(/^.*\//, "");

  const body = buildPullRequestBody({
    id,
    task: entry ? `Task ${id} was processed by NightShift.` : "",
    stat: "",
    gate: entry?.gate ?? "",
    costUSD: 0,
    durationMs: 0,
    harness: null,
  });

  const result = createPullRequest({
    cwd,
    branch,
    base,
    title: `nightshift: ${id}`,
    body,
    draft: Boolean(flags.draft ?? cfg.pullRequests?.draft),
    remote: cfg.pullRequests?.remote ?? "origin",
  });

  if (result.ok) {
    console.log(`${green(mark.ok)} pull request opened: ${result.url}`);
    return;
  }

  console.log(`${yellow(mark.warn)} pull request not created: ${result.reason}`);
  if (result.url) console.log(`  open it manually: ${result.url}`);
}

function status(cwd) {
  const cfg = loadConfig(cwd);
  const P = makePaths(cwd, cfg);
  const count = (dir, ext = ".md") =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).length : 0;

  const stateFile = P.state;
  let spent = 0;
  let runs = 0;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    spent = Number(state.spentUSD) || 0;
    runs = state.runs?.length ?? 0;
  } catch {
    // no state yet
  }

  console.log(`${bold("queue:")}  ${cyan(count(P.queue))}`);
  console.log(`${bold("done:")}   ${green(count(P.done))}`);
  console.log(`${bold("failed:")} ${count(P.failed) ? red(count(P.failed)) : count(P.failed)}`);
  console.log(`${bold("runs:")}   ${runs} (${fmtUSD(spent)} total)`);
  console.log(`${bold("report:")} ${P.report}`);
  console.log(gray('  details: nightshift list'));

  if (existsSync(P.report)) {
    const tail = readFileSync(P.report, "utf8").split(/\r?\n/).slice(-40).join("\n");
    console.log(`\n--- last report entries ---\n${tail}`);
  }
}

async function doctor(cwd) {
  console.log("nightshift doctor\n");
  let issues = 0;
  const ok = (msg) => console.log(`  [ok]   ${msg}`);
  const warn = (msg) => console.log(`  [warn] ${msg}`);
  const fail = (msg) => {
    issues += 1;
    console.log(`  [fail] ${msg}`);
  };

  // 1. Node.js runtime version
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split(".")[0], 10);
  if (major >= 20) ok(`Node.js v${nodeVer}`);
  else fail(`Node.js v${nodeVer} (requires >= 20.0.0)`);

  // 2. Git binary availability
  try {
    const { execSync } = await import("node:child_process");
    const gitVer = execSync("git --version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    ok(gitVer);
  } catch {
    fail("Git is not installed or not in PATH");
  }

  // 3. Inside git repository check
  try {
    const { execSync } = await import("node:child_process");
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    ok("Git repository detected");
  } catch {
    warn(`Current directory is not a git repository (${cwd})`);
  }

  // 4. Configuration and Agent CLI check
  const configPath = path.join(cwd, "nightshift.config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = loadConfig(cwd);
      ok(`Configuration valid (${configPath})`);
      ok(`Active harness: "${cfg.harness}"`);

      const { execSync } = await import("node:child_process");
      try {
        const bin = cfg.harness === "claude" ? "claude" : cfg.harness;
        const ver = execSync(`${bin} --version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        ok(`Agent CLI ready: ${bin} (${ver.split("\n")[0]})`);
      } catch {
        warn(`Agent CLI "${cfg.harness}" not found in PATH or not logged in yet`);
      }
    } catch (err) {
      fail(`Invalid config: ${err.message}`);
    }
  } else {
    warn("nightshift.config.json not found (run \"nightshift init\" to create)");
  }

  // 5. Tasks queue status
  const queueDir = path.join(cwd, "tasks", "queue");
  if (existsSync(queueDir)) {
    const queueFiles = readdirSync(queueDir).filter((f) => f.endsWith(".md"));
    ok(`Queue directory ready (${queueFiles.length} task(s) queued)`);
  } else {
    warn("tasks/queue directory not found (run \"nightshift init\" to create)");
  }

  console.log();
  if (issues === 0) {
    console.log("Environment check complete. NightShift is ready to run.");
  } else {
    console.log(`${issues} issue(s) detected. Please resolve them before starting unattended runs.`);
  }
}

main().catch((err) => {
  console.error(`nightshift: ${err.message}`);
  process.exit(1);
});
