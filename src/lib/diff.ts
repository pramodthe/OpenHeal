/**
 * Line and word diffing for the patch view.
 *
 * The previous viewer compared the two files by array index, which reports
 * every line after an insertion as modified. This does a real longest-common-
 * subsequence alignment so a one-line insertion reads as a one-line insertion.
 */

export type RowKind = 'eq' | 'change' | 'del' | 'ins';

export interface DiffRow {
  kind: RowKind;
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
}

export interface GapRow {
  kind: 'gap';
  count: number;
  /** Index into the full row list where the hidden run starts. */
  from: number;
}

export type ViewRow = DiffRow | GapRow;

export function isGap(row: ViewRow): row is GapRow {
  return row.kind === 'gap';
}

type Op = { type: 'eq' | 'del' | 'ins'; text: string };

/** Guard: the quadratic table is fine for source files, not for dumps. */
const MAX_CELLS = 4_000_000;

function lcsOps(a: string[], b: string[]): Op[] {
  // Trim the common head and tail first — most patches touch a few lines, so
  // this usually reduces the table to something trivial.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);

  const ops: Op[] = [];
  for (let i = 0; i < head; i++) ops.push({ type: 'eq', text: a[i] });

  if (aMid.length * bMid.length > MAX_CELLS) {
    for (const line of aMid) ops.push({ type: 'del', text: line });
    for (const line of bMid) ops.push({ type: 'ins', text: line });
  } else {
    const n = aMid.length;
    const m = bMid.length;
    const table = new Uint32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[at(i, j)] =
          aMid[i] === bMid[j]
            ? table[at(i + 1, j + 1)] + 1
            : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (aMid[i] === bMid[j]) {
        ops.push({ type: 'eq', text: aMid[i] });
        i++;
        j++;
      } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
        ops.push({ type: 'del', text: aMid[i] });
        i++;
      } else {
        ops.push({ type: 'ins', text: bMid[j] });
        j++;
      }
    }
    while (i < n) ops.push({ type: 'del', text: aMid[i++] });
    while (j < m) ops.push({ type: 'ins', text: bMid[j++] });
  }

  for (let k = b.length - tail; k < b.length; k++) ops.push({ type: 'eq', text: b[k] });
  return ops;
}

/**
 * Aligns the two files into rows. Adjacent deletions and insertions are paired
 * into `change` rows so the split view lines up the before and after.
 */
export function buildRows(original: string, patched: string): DiffRow[] {
  const a = original.split('\n');
  const b = patched.split('\n');
  const ops = lcsOps(a, b);

  const rows: DiffRow[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let dels: string[] = [];
  let inss: string[] = [];

  const flush = () => {
    const max = Math.max(dels.length, inss.length);
    for (let k = 0; k < max; k++) {
      const left = dels[k];
      const right = inss[k];
      if (left !== undefined && right !== undefined) {
        rows.push({ kind: 'change', left, right, leftNo: ++leftNo, rightNo: ++rightNo });
      } else if (left !== undefined) {
        rows.push({ kind: 'del', left, leftNo: ++leftNo });
      } else {
        rows.push({ kind: 'ins', right, rightNo: ++rightNo });
      }
    }
    dels = [];
    inss = [];
  };

  for (const op of ops) {
    if (op.type === 'del') {
      dels.push(op.text);
    } else if (op.type === 'ins') {
      inss.push(op.text);
    } else {
      flush();
      rows.push({
        kind: 'eq',
        left: op.text,
        right: op.text,
        leftNo: ++leftNo,
        rightNo: ++rightNo,
      });
    }
  }
  flush();

  return rows;
}

/**
 * Replaces long runs of unchanged lines with a gap marker, keeping `context`
 * lines either side of every change — the same convention as a unified diff.
 */
export function collapse(rows: DiffRow[], context = 3): ViewRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === 'eq') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });

  // A file with no changes at all stays fully visible.
  if (!keep.some(Boolean)) return rows;

  const out: ViewRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i]);
      i++;
      continue;
    }
    const from = i;
    while (i < rows.length && !keep[i]) i++;
    const count = i - from;
    // Not worth a marker for one or two lines — just show them.
    if (count <= 2) {
      for (let k = from; k < i; k++) out.push(rows[k]);
    } else {
      out.push({ kind: 'gap', count, from });
    }
  }
  return out;
}

export interface Token {
  text: string;
  changed: boolean;
}

/**
 * Word-level diff within a changed line pair, so the eye lands on the token
 * that actually moved rather than the whole line.
 */
export function wordDiff(left: string, right: string): { left: Token[]; right: Token[] } {
  const split = (s: string) => s.match(/(\s+|\w+|[^\s\w])/g) ?? [];
  const a = split(left);
  const b = split(right);

  if (a.length * b.length > 40_000) {
    return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }] };
  }

  const ops = lcsOps(a, b);
  const leftTokens: Token[] = [];
  const rightTokens: Token[] = [];

  for (const op of ops) {
    if (op.type === 'eq') {
      leftTokens.push({ text: op.text, changed: false });
      rightTokens.push({ text: op.text, changed: false });
    } else if (op.type === 'del') {
      leftTokens.push({ text: op.text, changed: true });
    } else {
      rightTokens.push({ text: op.text, changed: true });
    }
  }

  return { left: merge(leftTokens), right: merge(rightTokens) };
}

function merge(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (last && last.changed === token.changed) last.text += token.text;
    else out.push({ ...token });
  }
  return out;
}

export function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'ins') added++;
    else if (row.kind === 'del') removed++;
    else if (row.kind === 'change') {
      added++;
      removed++;
    }
  }
  return { added, removed };
}

/**
 * Added/removed totals across every file in a patch, computed from the file
 * contents themselves. The console shows this figure in three places, so it is
 * derived once from the diff rather than trusting counts that can disagree.
 */
export function statsForFiles(
  files: Array<{ originalContent?: string; patchedContent?: string }>
): { added: number; removed: number } {
  return files.reduce(
    (acc, f) => {
      const { added, removed } = countChanges(
        buildRows(f.originalContent || '', f.patchedContent || '')
      );
      return { added: acc.added + added, removed: acc.removed + removed };
    },
    { added: 0, removed: 0 }
  );
}
