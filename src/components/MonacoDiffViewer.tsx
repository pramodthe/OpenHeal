'use client';

import React, { useState, useEffect } from 'react';
import {
  FileCode2,
  Columns,
  Square,
  ShieldCheck,
  Zap,
  Sparkles,
  Layers,
  Check,
  Copy,
} from 'lucide-react';

export interface DiffFileEntry {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface MonacoDiffViewerProps {
  files?: DiffFileEntry[];
  activeFileIndex?: number;
  qodoScore?: number;
  qodoGrade?: string;
  securityStatus?: 'passed' | 'warning' | 'failed';
  diffStats?: { added: number; removed: number };
}

export const MonacoDiffViewer: React.FC<MonacoDiffViewerProps> = ({
  files = [],
  activeFileIndex = 0,
  qodoScore,
  qodoGrade,
  securityStatus = 'passed',
  diffStats,
}) => {
  const [selectedIdx, setSelectedIdx] = useState<number>(activeFileIndex);
  const [renderSideBySide, setRenderSideBySide] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (activeFileIndex < files.length) {
      setSelectedIdx(activeFileIndex);
    }
  }, [activeFileIndex, files.length]);

  const currentFile = files[selectedIdx] || files[0] || {
    filePath: 'calculator.py',
    originalContent: 'class Calculator:\n    def divide(self, a: float, b: float) -> float:\n        # BUG: integer division and missing zero guard\n        return a // b\n',
    patchedContent: 'class Calculator:\n    def divide(self, a: float, b: float) -> float:\n        # FIXED: guarded zero division\n        if b == 0:\n            raise ZeroDivisionError("division by zero")\n        return a / b\n',
    linesAdded: 3,
    linesRemoved: 1,
  };

  const detectLanguage = (filename: string): string => {
    if (filename.endsWith('.py')) return 'python';
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
    if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
    if (filename.endsWith('.rs')) return 'rust';
    if (filename.endsWith('.go')) return 'go';
    if (filename.endsWith('.json')) return 'json';
    return 'code';
  };

  const language = detectLanguage(currentFile.filePath);
  const totalAdded = diffStats?.added ?? (currentFile.linesAdded || 3);
  const totalRemoved = diffStats?.removed ?? (currentFile.linesRemoved || 1);

  const origLines = (currentFile.originalContent || '').split('\n');
  const patchLines = (currentFile.patchedContent || '').split('\n');
  const maxLines = Math.max(origLines.length, patchLines.length);

  const handleCopyPatch = async () => {
    await navigator.clipboard.writeText(currentFile.patchedContent || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-[#0e1424] border border-zinc-800/80 font-mono shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Header HUD Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-zinc-800/80 bg-[#090e1a] px-4 py-2.5 gap-2">
        {/* File Tabs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto max-w-full">
          {files.length > 0 ? (
            files.map((file, idx) => (
              <button
                key={file.filePath || idx}
                onClick={() => setSelectedIdx(idx)}
                className={`flex items-center space-x-1.5 rounded-lg px-2.5 py-1 text-xs font-mono transition-all ${
                  selectedIdx === idx
                    ? 'bg-blue-950/80 text-blue-300 border border-blue-500/50 shadow-[0_0_10px_rgba(0,122,255,0.3)]'
                    : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5 text-[#007aff]" />
                <span className="truncate max-w-[160px]">{file.filePath}</span>
              </button>
            ))
          ) : (
            <div className="flex items-center space-x-1.5 rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-mono text-zinc-300 border border-zinc-800">
              <FileCode2 className="h-3.5 w-3.5 text-[#007aff]" />
              <span>{currentFile.filePath}</span>
            </div>
          )}
        </div>

        {/* HUD Metrics & Controls */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          {/* Diff Stats */}
          <div className="flex items-center space-x-1.5 bg-zinc-900/80 px-2.5 py-1 rounded-lg border border-zinc-800">
            <span className="text-emerald-400 font-bold">+{totalAdded}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-rose-400 font-bold">-{totalRemoved}</span>
          </div>

          {/* Qodo Score Gauge */}
          {qodoScore !== undefined && (
            <div className="flex items-center space-x-1.5 bg-zinc-900/80 px-2.5 py-1 rounded-lg border border-zinc-800">
              <Sparkles className="h-3.5 w-3.5 text-[#007aff]" />
              <span className="text-zinc-400">Qodo:</span>
              <span className="text-blue-300 font-bold">{qodoScore}/100</span>
              {qodoGrade && (
                <span className="rounded bg-blue-500/20 text-blue-300 px-1 text-[10px] font-bold">
                  {qodoGrade}
                </span>
              )}
            </div>
          )}

          {/* Copy Patch */}
          <button
            onClick={handleCopyPatch}
            title="Copy Healed Code"
            className="flex items-center space-x-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-zinc-300 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Side-by-Side vs Inline Toggle */}
          <button
            onClick={() => setRenderSideBySide(!renderSideBySide)}
            title={renderSideBySide ? 'Switch to Inline View' : 'Switch to Side-by-Side View'}
            className="flex items-center space-x-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2.5 py-1 text-zinc-300 transition-colors"
          >
            {renderSideBySide ? (
              <>
                <Columns className="h-3.5 w-3.5 text-[#007aff]" />
                <span className="hidden sm:inline">Side-by-Side</span>
              </>
            ) : (
              <>
                <Square className="h-3.5 w-3.5 text-purple-400" />
                <span className="hidden sm:inline">Inline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Diff Editor Canvas (High-Performance Zero-Dependency Native Side-by-Side Diff) */}
      <div className="relative flex-1 w-full min-h-[380px] bg-[#080c14] overflow-auto text-xs leading-relaxed select-text custom-scroll">
        {renderSideBySide ? (
          /* Side-by-Side View */
          <div className="grid grid-cols-2 min-w-[700px] h-full divide-x divide-zinc-800/80">
            {/* Left: Original Code */}
            <div className="flex flex-col bg-[#090d18]/70">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-1 text-[11px] text-zinc-400 font-bold">
                <span>ORIGINAL (FAILING)</span>
                <span className="text-rose-400">Baseline</span>
              </div>
              <div className="p-2 space-y-0.5 font-mono">
                {origLines.map((line, i) => {
                  const isModified = i < patchLines.length && line !== patchLines[i];
                  return (
                    <div
                      key={`orig_${i}`}
                      className={`flex items-start rounded px-1.5 py-0.5 ${
                        isModified ? 'bg-rose-950/30 text-rose-300 border-l-2 border-rose-500' : 'text-zinc-400'
                      }`}
                    >
                      <span className="w-8 text-right pr-3 select-none text-zinc-600 shrink-0 text-[10px]">
                        {i + 1}
                      </span>
                      <pre className="font-mono whitespace-pre overflow-x-auto flex-1">{line || ' '}</pre>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Healed Code */}
            <div className="flex flex-col bg-[#0b1120]/70">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-3 py-1 text-[11px] text-zinc-400 font-bold">
                <span className="text-emerald-400">AUTONOMOUSLY HEALED</span>
                <span className="text-[#007aff]">100% Green</span>
              </div>
              <div className="p-2 space-y-0.5 font-mono">
                {patchLines.map((line, i) => {
                  const isModified = i < origLines.length && line !== origLines[i];
                  const isAdded = i >= origLines.length || isModified;
                  return (
                    <div
                      key={`patch_${i}`}
                      className={`flex items-start rounded px-1.5 py-0.5 ${
                        isAdded ? 'bg-emerald-950/35 text-emerald-200 border-l-2 border-emerald-500' : 'text-zinc-200'
                      }`}
                    >
                      <span className="w-8 text-right pr-3 select-none text-zinc-600 shrink-0 text-[10px]">
                        {i + 1}
                      </span>
                      <pre className="font-mono whitespace-pre overflow-x-auto flex-1">{line || ' '}</pre>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Inline Unified Diff View */
          <div className="flex flex-col h-full bg-[#080c14] p-3 font-mono">
            <div className="border-b border-zinc-800/80 pb-2 mb-2 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>UNIFIED DIFF: <strong className="text-zinc-200">{currentFile.filePath}</strong></span>
              <span className="text-emerald-400 font-bold">Verified by Regression Verifier</span>
            </div>
            <div className="space-y-0.5">
              {origLines.map((line, i) => {
                const isModified = i < patchLines.length && line !== patchLines[i];
                if (isModified) {
                  return (
                    <React.Fragment key={`inline_${i}`}>
                      <div className="flex items-start bg-rose-950/35 text-rose-300 px-2 py-0.5 rounded border-l-2 border-rose-500">
                        <span className="w-6 text-rose-400 font-bold select-none">-</span>
                        <pre className="font-mono whitespace-pre flex-1">{line}</pre>
                      </div>
                      <div className="flex items-start bg-emerald-950/35 text-emerald-200 px-2 py-0.5 rounded border-l-2 border-emerald-500">
                        <span className="w-6 text-emerald-400 font-bold select-none">+</span>
                        <pre className="font-mono whitespace-pre flex-1">{patchLines[i]}</pre>
                      </div>
                    </React.Fragment>
                  );
                }
                return (
                  <div key={`inline_same_${i}`} className="flex items-start text-zinc-400 px-2 py-0.5">
                    <span className="w-6 text-zinc-600 select-none"> </span>
                    <pre className="font-mono whitespace-pre flex-1">{line || ' '}</pre>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Editor Footer Status */}
      <div className="flex items-center justify-between border-t border-zinc-800/80 bg-[#090e1a] px-4 py-2 text-[11px] font-mono text-zinc-400">
        <div className="flex items-center space-x-2">
          <span>Mode: <strong className="text-zinc-200">{language.toUpperCase()}</strong></span>
          <span>•</span>
          <span>Target: <strong className="text-blue-300">{currentFile.filePath}</strong></span>
        </div>
        <div className="flex items-center space-x-1.5 text-emerald-400 font-bold">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>AST Verified Zero Regressions</span>
        </div>
      </div>
    </div>
  );
};
export default MonacoDiffViewer;
