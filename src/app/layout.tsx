import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenHeal — Self-healing mission control',
  description:
    'Diagnose failing tests, patch in a Daytona sandbox, verify green, then open a human-approved GitHub PR on the TrueForge harness.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#07110d] text-slate-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-50">
        {children}
      </body>
    </html>
  );
}
