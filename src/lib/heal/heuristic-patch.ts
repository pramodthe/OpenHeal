import { resolveBundledScenarioDir } from './scenarios.ts';

/**
 * Pre-baked scenario patches are demo-only. Production heals must come from the model,
 * except bundled lab fixtures where GitHub repos are placeholders.
 */
export function allowHeuristicPatches(scenarioId?: string): boolean {
  if (process.env.DEMO_OFFLINE === 'true' || process.env.NODE_ENV === 'test') return true;
  if (scenarioId && resolveBundledScenarioDir(scenarioId)) return true;
  return false;
}

export function applyScenarioHeuristicPatch(
  filePath: string,
  original: string,
  scenarioId?: string
): string {
  if (!allowHeuristicPatches(scenarioId)) return original;

  if (filePath.endsWith('.py') || original.includes('return a // b')) {
    const pythonPatched = patchPythonCalculator(original);
    if (pythonPatched !== original) return pythonPatched;
  }

  if (filePath.endsWith('.ts') || filePath.endsWith('.js') || original.includes('class ApiCache')) {
    const nodePatched = patchNodeCache(original);
    if (nodePatched !== original) return nodePatched;
  }

  if (filePath.endsWith('.rs') || original.includes('pub fn tokenize')) {
    const rustPatched = patchRustParser(original);
    if (rustPatched !== original) return rustPatched;
  }

  return original;
}

function patchPythonCalculator(original: string): string {
  if (!original.includes('return a // b') && !/return a\s*\/\s*b/.test(original)) {
    return original;
  }

  if (original.includes('raise ValueError("Cannot divide by zero")') && original.includes('return a / b')) {
    return original;
  }

  if (original.includes('return a // b')) {
    return original.replace(
      /return a \/\/ b/,
      'if b == 0:\n            raise ValueError("Cannot divide by zero")\n        return a / b'
    );
  }

  if (/return a\s*\/\s*b/.test(original) && !original.includes('if b == 0')) {
    return original.replace(
      /return a\s*\/\s*b/,
      'if b == 0:\n            raise ValueError("Cannot divide by zero")\n        return a / b'
    );
  }

  return original;
}

function patchNodeCache(original: string): string {
  let patched = original;

  if (patched.includes('BUG: Missing refresh of key')) {
    patched = patched.replace(
      /\n\s*\/\/ BUG: Missing refresh of key in Map to mark it as most recently used\n\s*return entry\.value;/,
      `\n    this.store.delete(key);\n    this.store.set(key, entry);\n\n    return entry.value;`
    );
  } else if (
    patched.includes('return entry.value;') &&
    patched.includes('class ApiCache') &&
    !patched.includes('this.store.set(key, entry);')
  ) {
    patched = patched.replace(
      /(\s*)return entry\.value;/,
      `$1this.store.delete(key);\n$1this.store.set(key, entry);\n$1return entry.value;`
    );
  }

  if (patched.includes('newestKey') || patched.includes('keys[keys.length - 1]')) {
    patched = patched.replace(
      /const keys = Array\.from\(this\.store\.keys\(\)\);\s*const newestKey = keys\[keys\.length - 1\];[^\n]*\n\s*if \(newestKey\) \{\s*this\.store\.delete\(newestKey\);\s*\}/s,
      `const oldestKey = this.store.keys().next().value;\n      if (oldestKey !== undefined) {\n        this.store.delete(oldestKey);\n      }`
    );
  }

  return patched;
}

function patchRustParser(original: string): string {
  if (original.includes("if chars[i] == '\\\\' && i + 1 < chars.len()") || original.includes('next_ch == \'"\'')) {
    return original;
  }

  const needle = `                while i < chars.len() {
                    // BUG: Does not check for escape backslash '\\' before '"'
                    if chars[i] == '"' {`;

  const replacement = `                while i < chars.len() {
                    if chars[i] == '\\\\' && i + 1 < chars.len() {
                        let next_ch = chars[i + 1];
                        if next_ch == '"' {
                            string_val.push('"');
                            i += 2;
                            continue;
                        } else if next_ch == '\\\\' {
                            string_val.push('\\\\');
                            i += 2;
                            continue;
                        }
                    }
                    if chars[i] == '"' {`;

  if (original.includes(needle)) {
    return original.replace(needle, replacement);
  }

  return original.replace(
    /while i < chars\.len\(\) \{\s*\/\/ BUG:[^\n]*\n\s*if chars\[i\] == '"'/s,
    `while i < chars.len() {\n                    if chars[i] == '\\\\' && i + 1 < chars.len() {\n                        let next_ch = chars[i + 1];\n                        if next_ch == '"' {\n                            string_val.push('"');\n                            i += 2;\n                            continue;\n                        } else if next_ch == '\\\\' {\n                            string_val.push('\\\\');\n                            i += 2;\n                            continue;\n                        }\n                    }\n                    if chars[i] == '"'`
  );
}
