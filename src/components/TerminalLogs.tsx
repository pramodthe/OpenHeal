'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  Search,
  Trash2,
  Copy,
  Check,
  ArrowDownCircle,
  Filter,
  Play,
} from 'lucide-react';

export interface TerminalLogEntry {
  id: string;
  source: 'agent' | 'sandbox' | 'qodo' | 'github_mcp' | 'system';
  text: string;
  timestamp: string;
  level?: 'info' | 'error' | 'success' | 'warn';
}

export interface TerminalLogsProps {
  logs: TerminalLogEntry[];
  onClearLogs?: () => void;
  isStreaming?: boolean;
}

const MAX_BUFFER_LINES = 5000;

export const TerminalLogs: React.FC<TerminalLogsProps> = ({
  logs = [],
  onClearLogs,
  isStreaming = false,
}) => {
  const [filterSource, setFilterSource] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new logs if enabled
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Handle user manual scroll up to pause auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const handleCopyLogs = async () => {
    const textToCopy = filteredLogs
      .map((l) => `[${l.timestamp.slice(11, 19)}] [${l.source.toUpperCase()}] ${l.text}`)
      .join('\n');
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = logs
    .filter((entry) => {
      if (filterSource !== 'ALL' && entry.source !== filterSource.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        return entry.text.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    })
    .slice(-MAX_BUFFER_LINES);

  const formatLineColor = (entry: TerminalLogEntry): string => {
    const text = entry.text;
    if (entry.level === 'error' || text.includes('FAILED') || text.includes('Error:') || text.includes('panic:')) {
      return 'text-rose-400';
    }
    if (entry.level === 'success' || text.includes('PASSED') || text.includes('SUCCESS') || text.includes('100% green')) {
      return 'text-emerald-400';
    }
    if (entry.level === 'warn' || text.includes('WARNING') || text.includes('WARN')) {
      return 'text-amber-400';
    }
    if (entry.source === 'agent') {
      return 'text-cyan-300';
    }
    if (entry.source === 'qodo') {
      return 'text-purple-300';
    }
    if (entry.source === 'github_mcp') {
      return 'text-indigo-300';
    }
    return 'text-zinc-300';
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-zinc-950/90 border border-zinc-800/90 font-mono shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Terminal Top Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-4 py-2.5 gap-2">
        {/* Terminal Title & Window Dots */}
        <div className="flex items-center space-x-2.5">
          <div className="flex space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex items-center space-x-1.5 text-xs text-zinc-300 font-semibold pl-1">
            <TerminalIcon className="h-3.5 w-3.5 text-cyan-400" />
            <span>Live Daytona Terminal Logs</span>
            {isStreaming && (
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping ml-1" />
            )}
          </div>
        </div>

        {/* Channels & Filters */}
        <div className="flex items-center space-x-2">
          {/* Source Tabs */}
          <div className="flex items-center space-x-1 bg-zinc-950/80 p-0.5 rounded border border-zinc-800 text-[11px]">
            {['ALL', 'AGENT', 'SANDBOX', 'QODO', 'GITHUB_MCP'].map((ch) => (
              <button
                key={ch}
                onClick={() => setFilterSource(ch)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  filterSource === ch
                    ? 'bg-cyan-950 text-cyan-300 font-semibold border border-cyan-800'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative hidden md:block">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-32 rounded bg-zinc-950/90 pl-7 pr-2 text-xs text-zinc-200 border border-zinc-800 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Action Buttons */}
          <button
            onClick={handleCopyLogs}
            title="Copy Logs"
            className="flex items-center space-x-1 rounded bg-zinc-800 hover:bg-zinc-700 p-1.5 text-xs text-zinc-300 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>

          {onClearLogs && (
            <button
              onClick={onClearLogs}
              title="Clear Terminal"
              className="flex items-center space-x-1 rounded bg-zinc-800 hover:bg-zinc-700 p-1.5 text-xs text-zinc-300 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            </button>
          )}
        </div>
      </div>

      {/* Main Terminal Output Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto p-3 text-xs leading-relaxed bg-black/95 select-text"
        style={{ minHeight: '260px' }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-600 text-xs">
            No logs captured yet. Initialize a self-healing session to stream execution logs.
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((entry) => (
              <div key={entry.id} className="flex items-start space-x-2 font-mono hover:bg-zinc-900/40 px-1 py-0.5 rounded">
                <span className="text-zinc-600 select-none text-[11px] shrink-0">
                  {entry.timestamp ? entry.timestamp.slice(11, 19) : '--:--:--'}
                </span>
                <span
                  className={`text-[10px] uppercase font-bold shrink-0 px-1 rounded border ${
                    entry.source === 'agent'
                      ? 'bg-cyan-950 text-cyan-400 border-cyan-800'
                      : entry.source === 'qodo'
                      ? 'bg-purple-950 text-purple-400 border-purple-800'
                      : entry.source === 'github_mcp'
                      ? 'bg-indigo-950 text-indigo-400 border-indigo-800'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {entry.source}
                </span>
                <span className={`break-all whitespace-pre-wrap ${formatLineColor(entry)}`}>
                  {entry.text}
                </span>
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        )}

        {/* Scroll Resume Pill if scrolled up */}
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="absolute bottom-3 right-4 flex items-center space-x-1 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 text-xs shadow-lg transition-all animate-bounce"
          >
            <ArrowDownCircle className="h-3.5 w-3.5" />
            <span>Resume Auto-scroll</span>
          </button>
        )}
      </div>

      {/* Terminal Footer Info */}
      <div className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/60 px-4 py-1.5 text-[11px] text-zinc-500">
        <div>
          <span>Lines: <strong className="text-zinc-300">{filteredLogs.length}</strong></span>
          <span className="mx-2">•</span>
          <span>Buffer: <strong className="text-zinc-300">{MAX_BUFFER_LINES} max</strong></span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>SSE Stream Active</span>
        </div>
      </div>
    </div>
  );
};
export default TerminalLogs;
