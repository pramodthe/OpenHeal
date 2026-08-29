import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_DIR = process.env.OPENHEAL_DATA_DIR?.trim() || '.openheal-data';

function dataPath(filename: string): string {
  return path.join(process.cwd(), DEFAULT_DIR, filename);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.join(process.cwd(), DEFAULT_DIR), { recursive: true });
}

export async function readJsonFile<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(dataPath(filename), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(filename: string, data: T): Promise<void> {
  await ensureDir();
  await fs.writeFile(dataPath(filename), JSON.stringify(data, null, 2), 'utf8');
}
