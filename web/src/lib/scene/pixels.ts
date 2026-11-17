// Tiny helpers for pixel art written as rows of characters.
// '.' is transparent; every other character is looked up in a palette whose
// values are CSS colours (normally `var(--token)`).

export type Palette = Readonly<Record<string, string>>;

/** One horizontal run of same-coloured pixels. */
export type Run = { x: number; y: number; w: number; fill: string };

/** Turn character rows into merged horizontal runs, offset by (ox, oy). */
export function toRuns(rows: readonly string[], palette: Palette, ox = 0, oy = 0): Run[] {
  const runs: Run[] = [];
  const width = rows[0]?.length ?? 0;
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`pixel art: row ${y} is ${row.length} wide, expected ${width}`);
    }
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const fill = palette[ch];
      if (fill === undefined) throw new Error(`pixel art: no colour for '${ch}'`);
      runs.push({ x: ox + x, y: oy + y, w: end - x, fill });
      x = end;
    }
  });
  return runs;
}

/** Paint `top` over `base` (non-'.' characters win), shifted by (dx, dy). */
export function over(base: readonly string[], top: readonly string[], dx = 0, dy = 0): string[] {
  const out = base.map((row) => row.split(''));
  top.forEach((row, y) => {
    const target = out[y + dy];
    if (!target) return;
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '.' && x + dx >= 0 && x + dx < target.length) target[x + dx] = row[x];
    }
  });
  return out.map((row) => row.join(''));
}

/** Mirror left-right. */
export function mirror(rows: readonly string[]): string[] {
  return rows.map((row) => row.split('').reverse().join(''));
}

/** Move everything up by `n` rows, keeping the height. */
export function raise(rows: readonly string[], n: number): string[] {
  const blank = '.'.repeat(rows[0]?.length ?? 0);
  return [...rows.slice(n), ...Array.from({ length: n }, () => blank)];
}
