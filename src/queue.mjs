import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";

export function paths(cwd, cfg) {
  const p = cfg.paths;
  return {
    queue: path.join(cwd, p.tasks),
    running: path.join(cwd, p.tasks, ".running"),
    done: path.join(cwd, p.done),
    failed: path.join(cwd, p.failed),
    work: path.join(cwd, p.work),
    logs: path.join(cwd, p.logs),
    state: path.join(cwd, p.state),
    report: path.join(cwd, p.report),
    prompt: path.join(cwd, ".nightshift", "prompt.md"),
  };
}

export function ensureDirs(P) {
  for (const dir of [P.queue, P.running, P.done, P.failed, P.work, P.logs]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** A crash mid-task leaves the file in .running/. Put it back so the night continues. */
export function recover(P) {
  for (const name of readdirSync(P.running).filter((f) => f.endsWith(".md"))) {
    const dest = path.join(P.queue, name);
    const src = path.join(P.running, name);
    // Never silently drop work: if the id is already queued, park the stale copy.
    renameSync(src, existsSync(dest) ? path.join(P.failed, name) : dest);
  }
}

/** Claim the next task atomically by moving it into .running/. */
export function claim(P) {
  const files = readdirSync(P.queue)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) return null;

  const name = files[0];
  const src = path.join(P.queue, name);
  const dest = path.join(P.running, name);
  renameSync(src, dest);
  return { id: name.replace(/\.md$/, ""), file: dest };
}

export function parseTask(file, id) {
  const raw = readFileSync(file, "utf8");
  let meta = {};
  let body = raw;

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }

  return { id, meta, body: body.trim() };
}

export function finish(file, destDir) {
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(file));
  renameSync(file, dest);
  return dest;
}

/**
 * List the task files in a directory with their frontmatter and title, so the
 * CLI can show a table without parsing every file twice.
 */
export function listTasks(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((name) => {
      const id = name.replace(/\.md$/, "");
      const file = path.join(dir, name);
      let meta = {};
      let title = null;

      try {
        const raw = readFileSync(file, "utf8");
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        const body = fm ? raw.slice(fm[0].length) : raw;

        if (fm) {
          for (const line of fm[1].split(/\r?\n/)) {
            const kv = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
            if (kv) meta[kv[1]] = kv[2].trim();
          }
        }

        const heading = body.match(/^#\s+(.+)$/m);
        if (heading) title = heading[1].trim();
      } catch {
        // an unreadable task file should not break the listing
      }

      return { id, file, meta, title };
    });
}
