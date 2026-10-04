/** Text and table helpers for the `nx` CLI: terminal-width aware, no dependencies. */

const GAP = "  ";

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function orDash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

/** Approximate terminal cell width (wide/emoji code points count as two). */
export function cellWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff)
  );
}

export function clip(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const character of text) {
    const size = isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
    if (used + size > width - 1) break;
    out += character;
    used += size;
  }
  return `${out}…`;
}

export function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - cellWidth(text)));
}

/** Width-bounded table: header, rule, rows; the widest columns shrink to fit. */
export function renderTable(headers: string[], rows: string[][], maxWidth: number): string {
  const widths = headers.map((header, index) =>
    Math.max(cellWidth(header), ...rows.map((row) => cellWidth(row[index] ?? ""))),
  );
  let total = widths.reduce((sum, width) => sum + width, 0) + (headers.length - 1) * GAP.length;
  while (total > maxWidth) {
    let widest = 0;
    for (let index = 1; index < widths.length; index += 1) {
      if (widths[index] > widths[widest]) widest = index;
    }
    if (widths[widest] <= Math.max(8, cellWidth(headers[widest]))) break;
    widths[widest] -= 1;
    total -= 1;
  }
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => pad(clip(cell, widths[index]), widths[index]))
      .join(GAP)
      .trimEnd();
  const rule = headers.map((_, index) => "─".repeat(widths[index])).join(GAP);
  return [line(headers), rule, ...rows.map((row) => line(row))].join("\n");
}

export function terminalWidth(): number {
  const columns = process.stdout.columns;
  return columns && columns > 40 ? columns : 120;
}
