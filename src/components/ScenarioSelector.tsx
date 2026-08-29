'use client';

import React, { useState } from 'react';
import {
  Play,
  Terminal,
  Code2,
  Clock,
  Layers,
  Key,
} from 'lucide-react';
import type { ScenarioItem } from '@/lib/scenarios-catalog';
import type { HealLaunchCredentials } from '@/lib/heal/credentials';
import { GitHubConnectButton } from '@/components/GitHubConnectButton';

export interface ScenarioSelectorProps {
  scenarios: ScenarioItem[];
  selectedScenarioId?: string;
  onSelectScenario: (scenario: ScenarioItem) => void;
  onStartHeal: (
    scenario: ScenarioItem,
    customUrl?: string,
    customCode?: string,
    customLog?: string,
    credentials?: HealLaunchCredentials
  ) => Promise<void>;
  isLoading?: boolean;
}

export const ScenarioSelector: React.FC<ScenarioSelectorProps> = ({
  scenarios = [],
  selectedScenarioId,
  onSelectScenario,
  onStartHeal,
  isLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'custom' | 'keys'>('matrix');
  const [selectedId, setSelectedId] = useState<string>(
    selectedScenarioId || scenarios[0]?.id || 'python-calculator'
  );
  const [customRepoUrl, setCustomRepoUrl] = useState<string>('https://github.com/my-org/backend-service');
  const [customLanguage, setCustomLanguage] = useState<'python' | 'node' | 'rust' | 'go'>('python');
  const [customTestCmd, setCustomTestCmd] = useState<string>('pytest tests/');
  const [customCode, setCustomCode] = useState<string>(`def calculate_discount(price: float, discount_pct: float) -> float:
    # BUG: doesn't handle discount > 1.0 or division by zero
    if discount_pct < 0:
        return price
    return price * (1 - discount_pct)
`);
  const [customErrorLog, setCustomErrorLog] = useState<string>(`FAILED tests/test_discount.py::test_invalid_discount
ValueError: discount_pct cannot exceed 100%
  File "src/pricing.py", line 4, in calculate_discount`);
  const [openaiKey, setOpenaiKey] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [daytonaKey, setDaytonaKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gpt-5.6-luna');

  const currentScenario = scenarios.find((s) => s.id === selectedId) || scenarios[0];

  const handleLaunch = () => {
    const credentials: HealLaunchCredentials = {
      openaiKey: openaiKey.trim() || undefined,
      githubToken: githubToken.trim() || undefined,
      daytonaKey: daytonaKey.trim() || undefined,
      model: selectedModel,
    };

    if (activeTab === 'custom') {
      const customScenario: ScenarioItem = {
        id: 'custom-live-repo',
        name: 'Custom Live Repository',
        language: customLanguage,
        description: 'Live failure diagnosis, patch, and verification.',
        testFramework: customLanguage === 'python' ? 'pytest' : customLanguage === 'node' ? 'jest' : 'cargo',
        targetRepoUrl: customRepoUrl.trim(),
        targetFiles: ['src/main.' + (customLanguage === 'python' ? 'py' : customLanguage === 'node' ? 'ts' : 'rs')],
        expectedBugType: 'RuntimeError',
        estimatedDurationMs: 4000,
        testCommand: customTestCmd.trim() || 'pytest',
      };
      onStartHeal(customScenario, customRepoUrl.trim(), customCode.trim(), undefined, credentials);
    } else if (currentScenario) {
      onStartHeal(currentScenario, undefined, undefined, undefined, credentials);
    }
  };

  const tabClass = (id: string) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-colors ${
      activeTab === id
        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
        : 'text-slate-500 hover:text-slate-200 border border-transparent'
    }`;

  const fieldClass =
    'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => setActiveTab('matrix')} className={tabClass('matrix')}>
            <Layers className="h-3.5 w-3.5" />
            Broken fixtures
          </button>
          <button onClick={() => setActiveTab('custom')} className={tabClass('custom')}>
            <Code2 className="h-3.5 w-3.5" />
            Your repo
          </button>
          <button onClick={() => setActiveTab('keys')} className={tabClass('keys')}>
            <Key className="h-3.5 w-3.5" />
            Keys
          </button>
        </div>
      </div>

      {activeTab === 'matrix' && (
        <div className="mb-3 grid grid-cols-1 gap-2">
          {scenarios.map((scenario) => {
            const isSelected = selectedId === scenario.id;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => {
                  setSelectedId(scenario.id);
                  onSelectScenario(scenario);
                }}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  isSelected
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">
                    {scenario.language}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                    <Clock className="h-3 w-3" />~{Math.round(scenario.estimatedDurationMs / 1000)}s
                  </span>
                </div>
                <h3 className="text-xs font-semibold text-white">{scenario.name}</h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{scenario.description}</p>
                <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
                  <span>{scenario.testFramework}</span>
                  <span className="text-rose-400">{scenario.expectedBugType}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'custom' && (
        <div className="mb-3 space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Repository
              <input className={`${fieldClass} mt-1`} value={customRepoUrl} onChange={(e) => setCustomRepoUrl(e.target.value)} />
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Language
              <select className={`${fieldClass} mt-1`} value={customLanguage} onChange={(e) => setCustomLanguage(e.target.value as typeof customLanguage)}>
                <option value="python">Python</option>
                <option value="node">Node / TypeScript</option>
                <option value="rust">Rust</option>
                <option value="go">Go</option>
              </select>
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Test command
              <input className={`${fieldClass} mt-1`} value={customTestCmd} onChange={(e) => setCustomTestCmd(e.target.value)} />
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Broken source
              <textarea className={`${fieldClass} mt-1`} rows={5} value={customCode} onChange={(e) => setCustomCode(e.target.value)} />
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-rose-400/80">
              Failure log
              <textarea className={`${fieldClass} mt-1 text-rose-300`} rows={4} value={customErrorLog} onChange={(e) => setCustomErrorLog(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {activeTab === 'keys' && (
        <div className="mb-3 space-y-3">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
            LLM key
            <input type="password" className={`${fieldClass} mt-1`} value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-…" />
          </label>
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">GitHub</p>
            <GitHubConnectButton />
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-[10px] text-slate-500">PAT fallback</summary>
              <input type="password" className={`${fieldClass} mt-2`} value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="ghp_…" />
            </details>
          </div>
          <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Daytona (optional)
            <input type="password" className={`${fieldClass} mt-1`} value={daytonaKey} onChange={(e) => setDaytonaKey(e.target.value)} />
          </label>
          <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Model
            <select className={`${fieldClass} mt-1`} value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
              <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
              <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
            </select>
          </label>
        </div>
      )}

      <GitHubConnectButton />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-black/30 p-2.5">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-slate-500">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate text-emerald-300/90">
            {activeTab === 'custom' ? customRepoUrl : currentScenario?.targetRepoUrl}
          </span>
        </div>
        <button
          onClick={handleLaunch}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 font-mono text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-950 border-t-transparent" />
          ) : (
            <Play className="h-3 w-3 fill-current" />
          )}
          {isLoading ? 'Healing…' : 'Start heal'}
        </button>
      </div>
    </div>
  );
};

export default ScenarioSelector;
