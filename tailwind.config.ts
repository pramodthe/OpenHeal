import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        foreground: '#f1f5f9',
        surface: {
          DEFAULT: '#0f172a',
          50: '#1e293b',
          100: '#0f172a',
          200: '#0b1120',
          border: '#1e293b',
        },
        cyber: {
          cyan: '#06b6d4',
          emerald: '#10b981',
          purple: '#8b5cf6',
          indigo: '#6366f1',
          rose: '#f43f5e',
          amber: '#f59e0b',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.01)' },
        },
        glowPulse: {
          '0%, 100%': {
            boxShadow: '0 0 15px rgba(6, 182, 212, 0.4), 0 0 30px rgba(16, 185, 129, 0.2)',
          },
          '50%': {
            boxShadow: '0 0 25px rgba(6, 182, 212, 0.7), 0 0 45px rgba(16, 185, 129, 0.4)',
          },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        },
      },
      animation: {
        'pulse-slow': 'pulseSlow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
