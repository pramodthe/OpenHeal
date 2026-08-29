#!/usr/bin/env node
/**
 * Free HTTPS tunnel for local Composio webhooks (no ngrok account needed).
 *
 * Usage: npm run tunnel
 * Writes the public URL to .openheal-tunnel-url, then restart dev or toggle Watch PRs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.env.PORT || process.env.OPENHEAL_PORT || '3000';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlFile = path.join(root, '.openheal-tunnel-url');

const binCandidates = [
  process.env.CLOUDFLARED_BIN,
  'cloudflared',
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
].filter(Boolean);

function resolveCloudflared() {
  for (const bin of binCandidates) {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {
      // try next
    }
  }
  return 'cloudflared';
}

const cloudflared = resolveCloudflared();
console.log(`[openheal] starting cloudflared → http://localhost:${port}`);
console.log('[openheal] waiting for HTTPS URL (trycloudflare.com)…');

const child = spawn(
  cloudflared,
  ['tunnel', '--url', `http://localhost:${port}`],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let saved = false;

function onLine(line) {
  process.stdout.write(`${line}\n`);
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !saved) {
    saved = true;
    const url = match[0].replace(/\/$/, '');
    fs.writeFileSync(urlFile, `${url}\n`, 'utf8');
    console.log('');
    console.log(`[openheal] tunnel URL saved → ${url}`);
    console.log('[openheal] next: restart npm run dev, then toggle Watch PRs on your repo');
    console.log(`[openheal] or set OPENHEAL_PUBLIC_URL=${url} in .env`);
  }
}

child.stdout.on('data', (chunk) => {
  for (const line of chunk.toString('utf8').split('\n')) {
    if (line.trim()) onLine(line);
  }
});

child.stderr.on('data', (chunk) => {
  for (const line of chunk.toString('utf8').split('\n')) {
    if (line.trim()) onLine(line);
  }
});

child.on('error', (err) => {
  console.error('[openheal] failed to start cloudflared:', err.message);
  console.error('[openheal] install it with: brew install cloudflared');
  process.exit(1);
});

child.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`[openheal] cloudflared exited with code ${code}`);
    process.exit(code);
  }
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
  try {
    fs.unlinkSync(urlFile);
  } catch {
    // ignore
  }
  process.exit(0);
});
