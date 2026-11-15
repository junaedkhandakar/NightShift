// Terminal presentation helpers. No dependencies on purpose.
//
// Colors are opt-out (NO_COLOR) and never used when stdout is not a TTY, so
// piped logs, CI output, and files stay clean ASCII.

const tty = () => process.stdout.isTTY === true;

const supportsColor = () =>
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  (tty() || process.env.FORCE_COLOR === "1");

const style = (open, close) => (text) =>
  supportsColor() ? `\u001B[${open}m${text}\u001B[${close}m` : String(text);

export const bold = style(1, 22);
export const dim = style(2, 22);
export const italic = style(3, 23);
export const underline = style(4, 24);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const blue = style(34, 39);
export const magenta = style(35, 39);
export const cyan = style(36, 39);
export const gray = style(90, 39);
export const inverse = style(7, 27);

/** Status marks, ASCII only, so Windows consoles never render tofu. */
export const mark = {
  ok: "[ok]",
  fail: "[FAIL]",
  run: "[RUN]",
  warn: "[warn]",
  info: "[info]",
};

/**
 * Render a fixed-width table. Columns are {title} objects; rows are arrays.
 * The widest cell wins, so columns never wrap and stay scannable.
 */
export function renderTable(columns, rows) {
  const cells = rows.map((row) => columns.map((_, i) => String(row[i] ?? "")));
  const widths = columns.map((col, i) =>
    Math.max(col.title.length, ...cells.map((row) => row[i].length)),
  );

  const line = (values) =>
    values
      .map((value, i) => value.padEnd(widths[i]))
      .join("  ")
      .trimEnd();

  const out = [line(columns.map((c) => bold(c.title))), line(widths.map((w) => gray("-".repeat(w))))];
  for (const row of cells) out.push(line(row));
  return out.join("\n");
}

const FRAMES = ["|", "/", "-", "\\"];

/**
 * A minimal spinner for long-running steps. Falls back to a plain line when
 * the output is not interactive, so logs stay readable.
 */
export function startSpinner(text) {
  const message = typeof text === "function" ? text : () => text;

  if (!tty() || process.env.NO_COLOR) {
    console.log(message());
    return { stop() {} };
  }

  let frame = 0;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    process.stdout.write(`\r${gray(FRAMES[frame++ % FRAMES.length])} ${message()}`);
  }, 120);
  timer.unref?.();

  return {
    stop(finalText) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write("\r\u001B[K");
      if (finalText) console.log(finalText);
    },
  };
}

/** A titled block, used to separate sections in terminal output. */
export function section(title) {
  console.log(`\n${bold(title)}`);
}
