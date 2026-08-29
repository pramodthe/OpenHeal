'use client';

import React, { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import type { ScenarioItem } from '@/lib/scenarios-catalog';
import type { HealLaunchCredentials } from '@/lib/heal/credentials';
import { GitHubConnectButton } from '@/components/GitHubConnectButton';

export interface RunSetupProps {
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

type Tab = 'samples' | 'repo' | 'connections';

/**
 * Model names come from the TrueForge catalog (`GET /api/v1/models`) when the
 * harness owns the run, and are passed straight to the provider otherwise.
 */
const MODELS: Array<{ value: string; label: string; group: string }> = [
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', group: 'TrueForge catalog' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', group: 'TrueForge catalog' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', group: 'TrueForge catalog' },
  { value: 'claude-opus-5', label: 'Claude Opus 5', group: 'Direct provider' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', group: 'Direct provider' },
  { value: 'gpt-4o', label: 'GPT-4o', group: 'Direct provider' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', group: 'Direct provider' },
];

const FIELD =
  'w-full rounded border border-rule bg-card px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-signal focus:outline-none';

export function RunSetup({
  scenarios = [],
  selectedScenarioId,
  onSelectScenario,
  onStartHeal,
  isLoading = false,
}: RunSetupProps) {
  const [tab, setTab] = useState<Tab>('samples');
  const [selectedId, setSelectedId] = useState(selectedScenarioId || scenarios[0]?.id || '');
  const [repoUrl, setRepoUrl] = useState('https://github.com/my-org/backend-service');
  const [language, setLanguage] = useState<ScenarioItem['language']>('python');
  const [testCommand, setTestCommand] = useState('pytest tests/');
  const [source, setSource] = useState(`def calculate_discount(price: float, discount_pct: float) -> float:
    if discount_pct < 0:
        return price
    return price * (1 - discount_pct)
`);
  const [llmKey, setLlmKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [daytonaKey, setDaytonaKey] = useState('');
  const [model, setModel] = useState(MODELS[0].value);

  const current = scenarios.find((s) => s.id === selectedId) || scenarios[0];

  const start = () => {
    const credentials: HealLaunchCredentials = {
      openaiKey: llmKey.trim() || undefined,
      githubToken: githubToken.trim() || undefined,
      daytonaKey: daytonaKey.trim() || undefined,
      model,
    };

    if (tab === 'repo') {
      const custom: ScenarioItem = {
        id: 'custom-live-repo',
        name: 'Your repository',
        language,
        description: 'A live run against your own repository.',
        testFramework: language === 'python' ? 'pytest' : language === 'node' ? 'jest' : 'cargo',
        targetRepoUrl: repoUrl.trim(),
        targetFiles: [
          `src/main.${language === 'python' ? 'py' : language === 'node' ? 'ts' : 'rs'}`,
        ],
        expectedBugType: 'RuntimeError',
        estimatedDurationMs: 4000,
        testCommand: testCommand.trim() || 'pytest',
      };
      void onStartHeal(custom, repoUrl.trim(), source.trim(), undefined, credentials);
    } else if (current) {
      void onStartHeal(current, undefined, undefined, undefined, credentials);
    }
  };

  const target = tab === 'repo' ? repoUrl : current?.targetRepoUrl;
  const canStart = !isLoading && Boolean(tab === 'repo' ? repoUrl.trim() : current);

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-0.5 border-b border-rule pb-2">
        {(
          [
            ['samples', 'Samples'],
            ['repo', 'Your repo'],
            ['connections', 'Connections'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id}
            className={`rounded px-2 py-1 text-[12px] transition-colors ${
              tab === id ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'samples' && (
        <div className="space-y-1.5">
          {scenarios.map((scenario) => {
            const active = selectedId === scenario.id;
            return (
              <button
                key={scenario.id}
                onClick={() => {
                  setSelectedId(scenario.id);
                  onSelectScenario(scenario);
                }}
                aria-pressed={active}
                className={`w-full rounded border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-signal bg-signal-wash'
                    : 'border-rule bg-card hover:border-rule-strong'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="t-display-sm text-[13px] text-ink">{scenario.name}</h3>
                  <span className="t-mono shrink-0 text-[10px] text-ink-3">
                    {scenario.language}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-ink-2">{scenario.description}</p>
                <p className="t-mono mt-1.5 text-[10px] text-fail">{scenario.expectedBugType}</p>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'repo' && (
        <div className="space-y-2.5">
          <Field label="Repository URL">
            <input className={FIELD} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </Field>
          <Field label="Language">
            <select
              className={FIELD}
              value={language}
              onChange={(e) => setLanguage(e.target.value as ScenarioItem['language'])}
            >
              <option value="python">Python</option>
              <option value="node">Node / TypeScript</option>
              <option value="rust">Rust</option>
              <option value="go">Go</option>
            </select>
          </Field>
          <Field label="Test command" hint="How OpenHeal runs your suite in the sandbox.">
            <input
              className={`${FIELD} font-mono`}
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
            />
          </Field>
          <Field
            label="Source to overlay"
            hint="Optional. Pastes this file into the clone before the baseline run."
          >
            <textarea
              className={`${FIELD} font-mono`}
              rows={6}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
        </div>
      )}

      {tab === 'connections' && (
        <div className="space-y-3">
          <div>
            <p className="t-label mb-1.5">GitHub</p>
            <GitHubConnectButton />
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-ink-2 hover:text-ink">
                Use a personal access token instead
              </summary>
              <input
                type="password"
                className={`${FIELD} mt-2`}
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_…"
                aria-label="GitHub personal access token"
              />
            </details>
          </div>

          <Field label="Model key" hint="Falls back to the key in your .env when blank.">
            <input
              type="password"
              className={FIELD}
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder="sk-…"
            />
          </Field>

          <Field label="Model">
            <select className={FIELD} value={model} onChange={(e) => setModel(e.target.value)}>
              {['TrueForge catalog', 'Direct provider'].map((group) => (
                <optgroup key={group} label={group}>
                  {MODELS.filter((m) => m.group === group).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Daytona key" hint="Without it, runs use the local sandbox instead.">
            <input
              type="password"
              className={FIELD}
              value={daytonaKey}
              onChange={(e) => setDaytonaKey(e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="mt-3 border-t border-rule pt-3">
        {target && (
          <p className="t-mono mb-2 truncate text-[11px] text-ink-3" title={target}>
            {target}
          </p>
        )}
        <button
          onClick={start}
          disabled={!canStart}
          className="flex w-full items-center justify-center gap-2 rounded bg-signal px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-signal-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Running
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
              Start run
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-3">{hint}</span>}
    </label>
  );
}

export default RunSetup;
