function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function isSeparator(line: string): boolean {
  return cells(line).every(cell => /^:?-{3,}:?$/.test(cell));
}

function separator(width: number, value: string): string {
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  const dashes = Math.max(3, width - Number(left) - Number(right));
  return `${left ? ":" : ""}${"-".repeat(dashes)}${right ? ":" : ""}`.padEnd(width, "-");
}

export function prettifyMarkdownTables(markdown: string): string {
  const lines = markdown.split("\n");
  for (let start = 0; start < lines.length - 1; start++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[start]) || !/^\s*\|.*\|\s*$/.test(lines[start + 1]) || !isSeparator(lines[start + 1])) continue;
    let end = start + 2;
    while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
    const rows = lines.slice(start, end).map(cells);
    const columnCount = Math.max(...rows.map(row => row.length));
    const widths = Array.from({ length: columnCount }, (_, column) => Math.max(
      3,
      ...rows.filter((_, row) => row !== 1).map(row => row[column]?.length ?? 0)
    ));
    for (let row = 0; row < rows.length; row++) {
      const values = widths.map((width, column) => row === 1
        ? separator(width, rows[row][column] ?? "---")
        : (rows[row][column] ?? "").padEnd(width));
      lines[start + row] = `| ${values.join(" | ")} |`;
    }
    start = end - 1;
  }
  return lines.join("\n");
}
