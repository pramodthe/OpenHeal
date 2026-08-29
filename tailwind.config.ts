import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          2: 'rgb(var(--paper-2) / <alpha-value>)',
        },
        card: 'rgb(var(--card) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
        },
        rule: {
          DEFAULT: 'rgb(var(--rule) / <alpha-value>)',
          strong: 'rgb(var(--rule-strong) / <alpha-value>)',
        },
        signal: {
          DEFAULT: 'rgb(var(--signal) / <alpha-value>)',
          ink: 'rgb(var(--signal-ink) / <alpha-value>)',
          wash: 'rgb(var(--signal-wash) / <alpha-value>)',
        },
        fail: {
          DEFAULT: 'rgb(var(--fail) / <alpha-value>)',
          wash: 'rgb(var(--fail-wash) / <alpha-value>)',
        },
        pass: {
          DEFAULT: 'rgb(var(--pass) / <alpha-value>)',
          wash: 'rgb(var(--pass-wash) / <alpha-value>)',
        },
        hold: {
          DEFAULT: 'rgb(var(--hold) / <alpha-value>)',
          wash: 'rgb(var(--hold-wash) / <alpha-value>)',
        },
        well: {
          DEFAULT: 'rgb(var(--well) / <alpha-value>)',
          2: 'rgb(var(--well-2) / <alpha-value>)',
          3: 'rgb(var(--well-3) / <alpha-value>)',
          rule: 'rgb(var(--well-rule) / <alpha-value>)',
          ink: 'rgb(var(--well-ink) / <alpha-value>)',
          'ink-2': 'rgb(var(--well-ink-2) / <alpha-value>)',
          fail: 'rgb(var(--well-fail) / <alpha-value>)',
          pass: 'rgb(var(--well-pass) / <alpha-value>)',
          signal: 'rgb(var(--well-signal) / <alpha-value>)',
          hold: 'rgb(var(--well-hold) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Archivo', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
      },
      borderRadius: {
        DEFAULT: '3px',
        md: '4px',
        lg: '6px',
      },
      maxWidth: {
        prose: '62ch',
      },
    },
  },
  plugins: [],
};

export default config;
