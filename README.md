<div align="center">

# NightShift

**Autonomous overnight supervisor for headless coding agents.**  
Queue verifiable tasks before you sleep. Wake up to isolated git branches and a verified test report.

[![npm version](https://img.shields.io/npm/v/@junaedkhandakar/nightshift?color=cb3837&style=flat-square)](https://www.npmjs.com/package/@junaedkhandakar/nightshift)
[![npm downloads](https://img.shields.io/npm/dt/@junaedkhandakar/nightshift?style=flat-square&color=28a745&logo=npm)](https://www.npmjs.com/package/@junaedkhandakar/nightshift)
[![previous downloads](https://img.shields.io/npm/dt/@junaed93/nightshift?style=flat-square&color=6c757d&label=previous%20scope%20downloads)](https://www.npmjs.com/package/@junaed93/nightshift)
[![npm license](https://img.shields.io/npm/l/@junaedkhandakar/nightshift?style=flat-square)](LICENSE)
[![node version](https://img.shields.io/node/v/@junaedkhandakar/nightshift?style=flat-square)](https://nodejs.org)
[![platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey?style=flat-square)](#install)
[![GitHub](https://img.shields.io/badge/github-junaedkhandakar%2FNightShift-blue?style=flat-square&logo=github)](https://github.com/junaedkhandakar/NightShift)

<p align="center">
  <sub>*Note: Total download count includes live historical downloads from <code>@junaed93/nightshift</code> prior to the username scope migration.*</sub>
</p>

---

</div>

NightShift acts as an unattended supervisor for your existing coding agents (Claude Code, OpenAI Codex, or OpenCode). It takes their non-interactive mode and enforces three safety boundaries:

1. **Fresh Process & Context per Task** — Prevents multi-hour context rot and runaway token bloat.
2. **External Verification Gate** — The agent's self-reported "Done" is ignored. Your actual test suite and build steps decide.
3. **Isolated Git Worktree per Task** — Work happens in dedicated ephemeral worktrees (`.nightshift/work/<id>`). One broken task cannot corrupt another or alter your main working tree.

```
 tasks/queue/*.md
        │
        ▼
 ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 │ Git Worktree │ ───► │  Agent CLI   │ ───► │  Test Gate   │
 │ (clean ref)  │      │ (fresh turn) │      │  (npm test)  │
 └──────────────┘      └──────────────┘      └──────────────┘
                                                     │
                             ┌───────────────────────┴───────────────────────┐
                             ▼                                               ▼
                    [PASS] Commit & Branch                         [FAIL] Quarantine
                    nightshift/<task-id>                           tasks/failed/<task-id>.md
                    + REPORT.md Entry                              + Captured BLOCKED.md
```

---

## Quick Start

### 1. Requirements

- **Node.js**: v20.0.0 or higher
- **Git**: 2.30 or higher
- Any supported AI CLI installed and logged in (Claude Code, Codex, or OpenCode)

Confirm prerequisites:
```bash
node --version    # must be >= v20
git --version
```

### 2. Installation

Install globally via npm:

```bash
npm install -g @junaedkhandakar/nightshift
```

Verify installation:
```bash
nightshift --version
```

---

## 5-Minute Setup

### Step 1: Initialize your repository

From the root of any git repository:

```bash
nightshift init
```

This scaffolds:
```
├── nightshift.config.json    # Supervisor configuration
├── tasks/
│   ├── queue/                # Place task markdown files here
│   │   └── 000-example.md
│   ├── done/                 # Completed tasks moved here
│   └── failed/               # Rejected tasks moved here
└── .nightshift/              # Logs, worktrees, and REPORT.md (auto-gitignored)
```

### Step 2: Check your setup with doctor

Run the built-in diagnostic to confirm your environment, git state, and agent CLI are ready:

```bash
nightshift doctor
```

### Step 3: Configure your Test Gate

Open `nightshift.config.json` and configure your verification commands:

```json
{
  "harness": "claude",
  "gate": ["npm test", "npm run build"],
  "protect": ["tests/**", "*.test.*", ".github/**", "package-lock.json"]
}
```

- **`gate`**: Commands that must exit 0. If any fail, the agent's work is rejected and quarantined.
- **`protect`**: File patterns the agent is forbidden from editing. If the agent modifies your test suite or CI files to "pass" tests artificially, NightShift rejects it immediately.

### Step 4: Write a Task

Tasks are simple Markdown files placed inside `tasks/queue/`. The filename becomes the task ID and git branch name.

Example: `tasks/queue/fix-login-redirect.md`
```markdown
---
minutes: 20
turns: 30
gate: npm test -- tests/auth
model: sonnet
---

# Fix Expired Session Redirect

When a session token expires, navigating to `/dashboard` renders a blank page instead of redirecting to `/login`.

### Acceptance Criteria:
- Expired tokens redirect to `/login` with `?expired=true`.
- Active, valid sessions are unaffected.
- No new runtime dependencies.
```

### Step 5: Test Free with Dry Run

Test your pipeline without spending API tokens or modifying real code:

```bash
nightshift run --dry-run --once
```

### Step 6: Start the Overnight Run

```bash
# Run one task interactively to observe
nightshift run --once

# Or run the entire queue overnight
nightshift run
```

When you return:
```bash
nightshift status
```
Check `.nightshift/REPORT.md` for a complete audit log, diffstats, and costs.

---

## Supported Agent Harnesses

NightShift interfaces directly with official agent CLIs:

| Harness | Flag / Setting | Execution Command | Required Auth |
| :--- | :--- | :--- | :--- |
| **Claude Code** *(default)* | `--harness claude` | `claude -p --dangerously-skip-permissions --output-format stream-json` | Logged in or `ANTHROPIC_API_KEY` |
| **Codex** | `--harness codex` | `codex exec --full-auto --json` | OpenAI Codex CLI login |
| **OpenCode** | `--harness opencode` | `opencode run` | OpenCode CLI configured |
| **Dummy** | `--harness dummy` | Internal simulation mock | None (Used for `--dry-run`) |

Switch harnesses per run:
```bash
nightshift run --harness codex
```

---

## CLI Reference

```
nightshift <command> [options]
```

| Command | Description |
| :--- | :--- |
| `nightshift init [--cwd <path>]` | Scaffolds configuration and task directories in the project. |
| `nightshift doctor` | Validates environment, Node version, Git status, and Agent CLI. |
| `nightshift run` | Processes all tasks in `tasks/queue/` sequentially. |
| `nightshift run --once` | Executes only the next task in queue and exits. |
| `nightshift run --dry-run` | Executes the queue using a simulated agent (no API cost). |
| `nightshift status` | Prints queue statistics, spend, and recent task report. |
| `nightshift retry <id>` | Moves a task from `tasks/failed/<id>.md` back to `tasks/queue/`. |
| `nightshift clean [--all]` | Cleans completed worktrees (add `--all` to prune branches). |
| `nightshift -v, --version` | Displays the current installed NightShift version. |
| `nightshift -h, --help` | Displays help message and available options. |

### CLI Overrides
Override configuration flags dynamically on any run:
- `--harness <name>` — `claude`, `codex`, `opencode`, or `dummy`
- `--model <model>` — Target specific LLM model ID
- `--minutes <n>` — Wall-clock timeout per task
- `--max-turns <n>` — Maximum conversational turns
- `--budget <usd>` — Spend ceiling (stops runner when reached)
- `--max-tasks <n>` — Maximum number of tasks to complete

---

## Configuration Reference

Settings live in `nightshift.config.json` at your project root:

```json
{
  "harness": "claude",
  "model": null,
  "limits": {
    "minutes": 45,
    "maxTurns": 60,
    "budgetUSD": 10.0,
    "maxTasks": 0
  },
  "gate": ["npm test"],
  "protect": [
    "tests/**",
    "*.test.*",
    ".github/**",
    "package-lock.json"
  ],
  "baseBranch": "HEAD",
  "branchPrefix": "nightshift/",
  "harnessArgs": {
    "claude": []
  },
  "notify": {
    "webhook": null,
    "format": "text"
  }
}
```

- **`limits.minutes`**: Wall-clock timeout enforced with process-tree termination.
- **`limits.budgetUSD`**: Hard spending stop (supported accurately on Claude via streaming token usage).
- **`protect`**: Glob patterns that reject tasks if modified by the agent.
- **`notify`**: Send execution summaries to Discord, Slack, or ntfy webhooks.

---

## Safety & Operational Security

Headless coding agents run code and execute shell commands without human intervention. Follow these best practices:

- **Use dedicated or throwaway environments**: Run NightShift inside containers, a VPS, or a secondary machine. (See `docker/` for Docker configurations).
- **Zero production secrets**: Do not expose production database credentials or high-privilege keys in the running environment.
- **Protected paths**: Keep tests and lockfiles protected in `nightshift.config.json`.
- **Zero automatic merge**: NightShift **never** pushes or merges into `main`. It creates reviewable branches (`nightshift/<task-id>`) for human inspection.

---

## Troubleshooting

| Symptom | Probable Cause | Recommended Fix |
| :--- | :--- | :--- |
| `nightshift is not recognized` | npm global bin directory is not on system `PATH` | Run `npm config get prefix`, add that path to your environment variables, and restart terminal. |
| `failed ... gate failed` | Verification test command returned exit code `!= 0` | Run your gate command manually (`npm test`) in your repo to inspect the failure. |
| `failed ... protected path` | The agent edited a restricted file (tests, lockfile, CI) | Reword the task prompt so the agent understands it must not touch test or CI definitions. |
| `failed ... timed out` | Task exceeded wall-clock minute limit | Increase `minutes` in the task frontmatter or break the task into smaller sub-tasks. |
| `failed ... not found` | Selected agent CLI is not installed or available | Verify the agent CLI (`claude --version`, `codex --version`, etc.) is installed globally. |
| Nothing happens on `run` | `tasks/queue/` contains no `.md` files | Add a Markdown task file to `tasks/queue/`. |

---

## Distribution & Development

### Working from Source

```bash
git clone https://github.com/junaedkhandakar/NightShift.git
cd NightShift
npm install
npm test
npm link
```

### Automated Release Workflow

Releases are published automatically to npm using GitHub Actions Trusted Publishing (OIDC):

```bash
npm version patch      # Bumps version, commits, and creates tag
git push --follow-tags
```

---

## License

MIT © [Junaed Khandakar](https://github.com/junaedkhandakar)
