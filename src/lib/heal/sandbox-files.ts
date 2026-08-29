import type { ISandboxInstance } from '../daytona/types.ts';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  '__pycache__',
  'venv',
  '.venv',
  'dist',
  '.next',
  '.openheal',
]);

const TEXT_EXT = new Set([
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.go',
  '.json',
  '.toml',
  '.txt',
  '.md',
  '.yml',
  '.yaml',
  '.lock',
]);

export async function collectRepoFiles(
  sandbox: ISandboxInstance,
  root = 'repo'
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await walk(sandbox, root, '', files);
  return files;
}

async function walk(
  sandbox: ISandboxInstance,
  dirPath: string,
  prefix: string,
  files: Map<string, string>
): Promise<void> {
  let entries: Array<{ name: string; isDir: boolean }> = [];
  try {
    entries = await sandbox.listFiles(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      if (entry.name !== '.gitignore') continue;
    }
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = dirPath.endsWith('/') ? `${dirPath}${entry.name}` : `${dirPath}/${entry.name}`;

    if (entry.isDir) {
      await walk(sandbox, full, relative, files);
      continue;
    }

    const ext = extensionOf(entry.name);
    if (ext && !TEXT_EXT.has(ext) && entry.name !== 'Dockerfile') continue;
    if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg')) continue;

    try {
      const content = await sandbox.readFile(full);
      files.set(relative, content);
    } catch {
      // ignore unreadable files
    }
  }
}

export async function overlayCustomCode(
  sandbox: ISandboxInstance,
  language: string,
  customCode: string,
  explicitPath?: string
): Promise<string> {
  const filePath = explicitPath || defaultCustomPath(language);
  await sandbox.uploadFile(filePath, customCode);
  return filePath;
}

export function toRepoRelativePath(filePath: string): string {
  if (!filePath) return filePath;
  const cleaned = filePath.replace(/\\/g, '/');
  const repoMarker = '/repo/';
  const idx = cleaned.lastIndexOf(repoMarker);
  if (idx >= 0) {
    return cleaned.slice(idx + repoMarker.length);
  }
  return cleaned.replace(/^\.\//, '').replace(/^\/+/, '');
}

export function defaultCustomPath(language: string): string {
  switch (language) {
    case 'python':
      return 'src/main.py';
    case 'node':
      return 'src/main.ts';
    case 'rust':
      return 'src/main.rs';
    case 'go':
      return 'src/main.go';
    default:
      return 'src/main.txt';
  }
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}
