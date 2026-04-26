import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Guard test: prevents trial-related copy from creeping back into the product.
 * The 14-day free trial was removed; user-facing surfaces must stay clean.
 */

const ROOT = resolve(__dirname, '..', '..');

const SCAN_DIRS = ['src', 'public'];
const SCAN_ROOT_FILES = ['index.html', 'README.md'];
const EXTS = new Set(['.tsx', '.ts', '.md', '.json', '.html']);

const EXCLUDE_PATHS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'src/integrations/supabase/types.ts',
  'src/test/noTrialLanguage.test.ts',
  // Dead component scheduled for deletion; explicitly excluded if it lingers.
  'src/components/TrialBanner.tsx',
  'supabase/migrations',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
];

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: '14-day', regex: /\b14[- ]day\b/i },
  { name: 'free trial', regex: /\bfree[ -]trial\b/i },
  { name: 'trial ends', regex: /\btrial ends\b/i },
  { name: 'trial expired', regex: /\btrial expired\b/i },
  { name: 'start trial', regex: /\bstart trial\b/i },
  { name: 'trialing', regex: /\btrialing\b/i },
  { name: 'days left', regex: /\bdays left\b/i },
  { name: 'trial period', regex: /\btrial period\b/i },
];

const ALLOWLIST_MARKER = 'trial-allowlist';

function isExcluded(rel: string): boolean {
  const norm = rel.split('\\').join('/');
  return EXCLUDE_PATHS.some((ex) => norm === ex || norm.startsWith(ex + '/'));
}

function walk(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (isExcluded(rel)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot) : '';
      if (EXTS.has(ext)) out.push(full);
    }
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  for (const f of SCAN_ROOT_FILES) {
    const full = join(ROOT, f);
    try {
      if (statSync(full).isFile()) files.push(full);
    } catch {
      /* missing root file is fine */
    }
  }
  return files;
}

interface Hit {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

describe('No trial-related language in user-facing code', () => {
  it('contains zero trial copy across scanned files', () => {
    const files = collectFiles();
    const hits: Hit[] = [];

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(ALLOWLIST_MARKER)) continue;
        for (const p of PATTERNS) {
          if (p.regex.test(line)) {
            hits.push({
              file: relative(ROOT, file),
              line: i + 1,
              pattern: p.name,
              text: line.trim().slice(0, 200),
            });
          }
        }
      }
    }

    if (hits.length > 0) {
      const summary = hits
        .map((h) => `  ${h.file}:${h.line}  [${h.pattern}]  ${h.text}`)
        .join('\n');
      throw new Error(
        `Found ${hits.length} trial-language match(es):\n${summary}\n\n` +
          `If a match is intentional (e.g., legacy comment), append "// ${ALLOWLIST_MARKER}" on that line.`,
      );
    }

    expect(hits).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  });
});
