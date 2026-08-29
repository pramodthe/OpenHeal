'use client';

import React, { useMemo, useState } from 'react';
import { Check, Columns2, Copy, Rows3 } from 'lucide-react';
import {
  buildRows,
  collapse,
  countChanges,
  isGap,
  wordDiff,
  type DiffRow,
  type ViewRow,
} from '@/lib/diff';

export interface DiffFileEntry {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface PatchViewProps {
  files?: DiffFileEntry[];
  activeFileIndex?: number;
  /** Shown as the empty state's target file before a run produces a patch. */
  placeholderPath?: string;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  py: 'Python',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  rs: 'Rust',
  go: 'Go',
  json: 'JSON',
  toml: 'TOML',
  md: 'Markdown',
};

function languageOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXT[ext] ?? 'Plain text';
}

export function PatchView({ files = [], activeFileIndex = 0, placeholderPath }: PatchViewProps) {
  const [selected, setSelected] = useState(activeFileIndex);
  const [split, setSplit] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const file = files[selected] ?? files[0];

  const rows = useMemo(
    () => (file ? buildRows(file.originalContent || '', file.patchedContent || '') : []),
    [file]
  );
  const stats = useMemo(() => countChanges(rows), [rows]);
  const view = useMemo(() => collapse(rows, 3), [rows]);

  const visible: ViewRow[] = useMemo(
    () =>
      view.flatMap((row) =>
        isGap(row) && expanded.has(row.from) ? rows.slice(row.from, row.from + row.count) : [row]
      ),
    [view, expanded, rows]
  );

  const copyPatch = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.diff || file.patchedContent || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!file) {
    return <PatchEmptyState placeholderPath={placeholderPath} />;
  }

  const toggleGap = (from: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(from);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar sits on paper — chrome stays light, only the code goes dark */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {files.map((f, i) => (
            <button
              key={f.filePath || i}
              onClick={() => setSelected(i)}
              aria-current={selected === i}
              className={`t-mono max-w-[240px] shrink-0 truncate rounded px-2 py-1 text-[11px] transition-colors ${
                selected === i
                  ? 'bg-ink text-paper'
                  : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
              }`}
            >
              {f.filePath}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="t-num text-[11px]">
            <span className="text-pass">+{stats.added}</span>
            <span className="mx-1 text-ink-3">/</span>
            <span className="text-fail">−{stats.removed}</span>
          </span>

          <div className="flex items-center rounded border border-rule bg-card p-0.5">
            <button
              onClick={() => setSplit(true)}
              aria-pressed={split}
              title="Side by side"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                split ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Columns2 className="h-3 w-3" strokeWidth={2} />
              Split
            </button>
            <button
              onClick={() => setSplit(false)}
              aria-pressed={!split}
              title="Unified"
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                !split ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Rows3 className="h-3 w-3" strokeWidth={2} />
              Unified
            </button>
          </div>

          <button
            onClick={copyPatch}
            className="flex items-center gap-1.5 rounded border border-rule bg-card px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
          >
            {copied ? (
              <Check className="h-3 w-3 text-pass" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3 w-3" strokeWidth={2} />
            )}
            {copied ? 'Copied' : 'Copy patch'}
          </button>
        </div>
      </div>

      {/* The well */}
      <div className="well m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded">
        <div className="flex shrink-0 items-center justify-between border-b border-well-rule px-3 py-1.5">
          <span className="t-mono truncate text-[11px] text-well-ink-2">{file.filePath}</span>
          <span className="t-label !text-well-ink-2">{languageOf(file.filePath)}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {split ? (
            <SplitBody rows={visible} onExpand={toggleGap} />
          ) : (
            <UnifiedBody rows={visible} onExpand={toggleGap} />
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SplitBody({
  rows,
  onExpand,
}: {
  rows: ViewRow[];
  onExpand: (from: number) => void;
}) {
  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col className="w-[44px]" />
        <col className="w-1/2" />
        <col className="w-[44px]" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          if (isGap(row)) {
            return (
              <tr key={`gap-${row.from}`}>
                <td colSpan={4} className="p-0">
                  <GapBar count={row.count} onClick={() => onExpand(row.from)} />
                </td>
              </tr>
            );
          }

          const pair =
            row.kind === 'change' ? wordDiff(row.left ?? '', row.right ?? '') : null;

          return (
            <tr key={i} className="align-top">
              <LineNo n={row.leftNo} side={row.kind === 'eq' ? 'eq' : 'del'} show={row.left !== undefined} />
              <CodeCell
                text={row.left}
                tokens={pair?.left}
                tone={row.kind === 'eq' ? 'eq' : row.left !== undefined ? 'del' : 'blank'}
              />
              <LineNo n={row.rightNo} side={row.kind === 'eq' ? 'eq' : 'ins'} show={row.right !== undefined} />
              <CodeCell
                text={row.right}
                tokens={pair?.right}
                tone={row.kind === 'eq' ? 'eq' : row.right !== undefined ? 'ins' : 'blank'}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function UnifiedBody({
  rows,
  onExpand,
}: {
  rows: ViewRow[];
  onExpand: (from: number) => void;
}) {
  const flat: Array<{ tone: 'eq' | 'del' | 'ins'; text: string; n?: number } | ViewRow> = [];
  for (const row of rows) {
    if (isGap(row)) {
      flat.push(row);
    } else if (row.kind === 'eq') {
      flat.push({ tone: 'eq', text: row.left ?? '', n: row.leftNo });
    } else {
      if (row.left !== undefined) flat.push({ tone: 'del', text: row.left, n: row.leftNo });
      if (row.right !== undefined) flat.push({ tone: 'ins', text: row.right, n: row.rightNo });
    }
  }

  return (
    <table className="w-full border-collapse">
      <colgroup>
        <col className="w-[44px]" />
        <col className="w-[20px]" />
        <col />
      </colgroup>
      <tbody>
        {flat.map((item, i) => {
          if ('kind' in item && isGap(item as ViewRow)) {
            const gap = item as Extract<ViewRow, { kind: 'gap' }>;
            return (
              <tr key={`gap-${gap.from}`}>
                <td colSpan={3} className="p-0">
                  <GapBar count={gap.count} onClick={() => onExpand(gap.from)} />
                </td>
              </tr>
            );
          }
          const line = item as { tone: 'eq' | 'del' | 'ins'; text: string; n?: number };
          return (
            <tr key={i} className="align-top">
              <LineNo n={line.n} side={line.tone} show />
              <td
                className={`t-mono select-none px-1 text-center text-[12px] leading-[19px] ${
                  line.tone === 'del'
                    ? 'bg-[#2a1416] text-well-fail'
                    : line.tone === 'ins'
                      ? 'bg-[#0f2119] text-well-pass'
                      : ''
                }`}
              >
                {line.tone === 'del' ? '−' : line.tone === 'ins' ? '+' : ''}
              </td>
              <CodeCell text={line.text} tone={line.tone} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LineNo({
  n,
  side,
  show,
}: {
  n?: number;
  side: 'eq' | 'del' | 'ins';
  show: boolean;
}) {
  return (
    <td
      className={`t-num select-none border-r border-well-rule px-2 text-right align-top text-[11px] leading-[19px] text-well-ink-2 ${
        side === 'del' ? 'bg-[#22090b]' : side === 'ins' ? 'bg-[#0a1a13]' : ''
      }`}
    >
      {show ? n : ''}
    </td>
  );
}

function CodeCell({
  text,
  tokens,
  tone,
}: {
  text?: string;
  tokens?: Array<{ text: string; changed: boolean }>;
  tone: 'eq' | 'del' | 'ins' | 'blank';
}) {
  const bg =
    tone === 'del'
      ? 'bg-[#2a1416]'
      : tone === 'ins'
        ? 'bg-[#0f2119]'
        : tone === 'blank'
          ? 'bg-well-2/40'
          : '';
  const fg =
    tone === 'del' ? 'text-well-fail' : tone === 'ins' ? 'text-well-pass' : 'text-well-ink';

  return (
    <td className={`px-2 ${bg}`}>
      <pre className={`t-mono whitespace-pre text-[12px] leading-[19px] ${fg}`}>
        {tokens
          ? tokens.map((t, i) =>
              t.changed ? (
                <mark
                  key={i}
                  className={`rounded-sm bg-transparent px-px ${
                    tone === 'del'
                      ? 'bg-[#5c1f22] text-[#ffb3ab]'
                      : 'bg-[#1a4433] text-[#8ff0bd]'
                  }`}
                >
                  {t.text}
                </mark>
              ) : (
                <span key={i}>{t.text}</span>
              )
            )
          : (text ?? '') || ' '}
      </pre>
    </td>
  );
}

function GapBar({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="t-num flex w-full items-center gap-2 border-y border-well-rule bg-well-2 px-3 py-1 text-left text-[11px] text-well-ink-2 transition-colors hover:bg-well-3 hover:text-well-ink"
    >
      <span aria-hidden className="text-well-signal">
        ⋯
      </span>
      Show {count} unchanged {count === 1 ? 'line' : 'lines'}
    </button>
  );
}

function PatchEmptyState({ placeholderPath }: { placeholderPath?: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-rule px-3 py-2">
        <span className="t-label">No patch yet</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-prose text-center">
          <p className="t-display-sm text-[15px] text-ink">Nothing to review yet</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Start a run and the proposed change lands here, side by side with the
            code it replaces.
          </p>
          {placeholderPath && (
            <p className="t-mono mt-4 text-[11px] text-ink-3">Watching {placeholderPath}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatchView;
