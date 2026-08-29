'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, ChevronDown, Copy, Search, Trash2 } from 'lucide-react';

export interface TerminalLogEntry {
  id: string;
  source: 'agent' | 'sandbox' | 'qodo' | 'github_mcp' | 'system' | 'trace';
  text: string;
  timestamp: string;
  level?: 'info' | 'error' | 'success' | 'warn';
}

export interface LogStreamProps {
  logs: TerminalLogEntry[];
  onClearLogs?: () => void;
  isStreaming?: boolean;
  onCollapse?: () => void;
}

const MAX_BUFFER_LINES = 5000;

const SOURCES = [
  { id: 'ALL', label: 'All' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'trace', label: 'Turns' },
  { id: 'agent', label: 'Agent' },
  { id: 'qodo', label: 'Qodo' },
  { id: 'github_mcp', label: 'GitHub' },
] as const;

/** A quiet colour rule per channel, so you can scan without reading. */
const CHANNEL_RULE: Record<string, string> = {
  agent: 'rgb(var(--well-signal))',
  trace: '#6b8afd',
  sandbox: 'rgb(var(--well-ink-2))',
  qodo: '#b18cf0',
  github_mcp: 'rgb(var(--well-pass))',
  system: 'rgb(var(--well-rule))',
};

export function LogStream({
  logs = [],
  onClearLogs,
  isStreaming = false,
  onCollapse,
}: LogStreamProps) {
  const [source, setSource] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs
      .filter((entry) => {
        if (source !== 'ALL' && entry.source !== source) return false;
        if (needle) return entry.text.toLowerCase().includes(needle);
        return true;
      })
      .slice(-MAX_BUFFER_LINES);
  }, [logs, source, query]);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ block: 'end' });
  }, [filtered.length, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const copyLogs = async () => {
    await navigator.clipboard.writeText(
      filtered.map((l) => `${l.timestamp.slice(11, 19)}  ${l.source}  ${l.text}`).join('\n')
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const toneFor = (entry: TerminalLogEntry): string => {
    const t = entry.text;
    if (entry.level === 'error' || /FAILED|Error:|panic:|Traceback/.test(t)) return 'text-well-fail';
    if (entry.level === 'success' || /PASSED|\bok\b|passed/.test(t)) return 'text-well-pass';
    if (entry.level === 'warn' || /WARN/i.test(t)) return 'text-well-hold';
    if (entry.source === 'agent') return 'text-well-signal';
    return 'text-well-ink';
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="t-label">Log</h2>
          <div className="flex items-center gap-0.5">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSource(s.id)}
                aria-pressed={source === s.id}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  source === s.id
                    ? 'bg-ink text-paper'
                    : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3"
              strokeWidth={2}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter"
              aria-label="Filter log lines"
              className="h-6 w-28 rounded border border-rule bg-card pl-6 pr-2 text-[11px] text-ink placeholder:text-ink-3 focus:border-signal focus:outline-none"
            />
          </div>
          <button
            onClick={copyLogs}
            title="Copy visible lines"
            className="rounded border border-rule bg-card p-1 text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
          >
            {copied ? (
              <Check className="h-3 w-3 text-pass" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3 w-3" strokeWidth={2} />
            )}
            <span className="sr-only">Copy log</span>
          </button>
          {onClearLogs && (
            <button
              onClick={onClearLogs}
              title="Clear log"
              className="rounded border border-rule bg-card p-1 text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
              <span className="sr-only">Clear log</span>
            </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse log"
              className="rounded border border-rule bg-card p-1 text-ink-2 transition-colors hover:border-rule-strong hover:text-ink"
            >
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
              <span className="sr-only">Collapse log</span>
            </button>
          )}
        </div>
      </div>

      <div className="well relative m-3 mt-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-auto py-1"
          role="log"
          aria-live="polite"
          aria-label="Run output"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-8 text-center">
              <p className="t-mono text-[11px] leading-relaxed text-well-ink-2">
                {logs.length === 0
                  ? 'Output from the sandbox and the agents streams here while a run is going.'
                  : 'No lines match this filter.'}
              </p>
            </div>
          ) : (
            <>
              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 border-l-2 py-[1px] pl-2 pr-3 hover:bg-well-2"
                  style={{ borderColor: CHANNEL_RULE[entry.source] ?? 'rgb(var(--well-rule))' }}
                >
                  <span className="t-num shrink-0 select-none text-[11px] leading-[17px] text-well-ink-2">
                    {entry.timestamp ? entry.timestamp.slice(11, 19) : '--:--:--'}
                  </span>
                  <span className="t-mono w-[54px] shrink-0 select-none truncate text-[10px] leading-[17px] text-well-ink-2">
                    {entry.source === 'github_mcp' ? 'github' : entry.source}
                  </span>
                  <pre
                    className={`t-mono min-w-0 flex-1 whitespace-pre-wrap break-words text-[11.5px] leading-[17px] ${toneFor(entry)}`}
                  >
                    {entry.text}
                  </pre>
                </div>
              ))}
              <div ref={endRef} />
            </>
          )}
        </div>

        {!autoScroll && filtered.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true);
              endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-signal px-3 py-1 text-[11px] font-medium text-white shadow-lg"
          >
            <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
            Jump to latest
          </button>
        )}

        <div className="flex shrink-0 items-center justify-between border-t border-well-rule px-3 py-1">
          <span className="t-num text-[10px] text-well-ink-2">
            {filtered.length.toLocaleString()}
            {filtered.length !== logs.length && ` of ${logs.length.toLocaleString()}`} lines
          </span>
          <span className="t-num flex items-center gap-1.5 text-[10px] text-well-ink-2">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                isStreaming ? 'anim-playhead bg-well-pass' : 'bg-well-rule'
              }`}
            />
            {isStreaming ? 'Streaming' : 'Not connected'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default LogStream;
