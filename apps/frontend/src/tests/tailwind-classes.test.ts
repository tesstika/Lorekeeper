// The static scan reads .vue files from disk; node types are pulled in for this
// test file only — the frontend program itself stays browser-pure.
/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __unstable__loadDesignSystem, compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

// Compile-level hygiene checks that mirror the two Tailwind IntelliSense lint rules
// ("suggestCanonicalClasses" and "cssConflict") so `bun run test` fails on exactly
// what the editor would flag. The project's real tailwind.css is loaded so theme
// tokens and the spacing scale match production output.
//
//   1. Canonical classes — a class whose canonical form differs is flagged, e.g.
//      arbitrary px/rem values with scale equivalents (max-w-[420px] → max-w-105),
//      v3→v4 renames (flex-shrink-0 → shrink-0, bg-gradient-to-tr → bg-linear-to-tr),
//      and bracket values with bare equivalents (z-[60] → z-60).
//   2. CSS conflicts — two classes on one element whose compiled rules have equal
//      ordered property lists (including --tw-* custom properties) and equal at-rule
//      context (e.g. transition-transform + transition-colors). Different variants
//      (base vs hover:, sm: responsive) intentionally do not conflict.
//
// Extraction mirrors the extension's lexers: static class="..." attributes are one
// class list; each quoted string inside a :class binding is its own class list
// (ternary/object branches are exclusive and never compared). Script sections are
// not scanned (classFunctions default to none), matching the extension.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');

interface Finding {
  file: string;
  line: number;
  message: string;
}

interface RuleEntry {
  /** Declaration properties in output order, including custom --tw-* properties. */
  properties: string[];
  /** Ancestor at-rule chain plus own selector context ('&'-normalized). */
  context: string[];
}

function collectVueFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.vue'))
    .map((entry) => path.join(dir, entry));
}

// ---------- class list extraction (mirrors the extension's lexers) ----------

function extractClassLists(attrValue: string, computed: boolean): string[] {
  const lists: string[] = [];
  let cur = '';
  const stack: string[] = [];

  const flush = () => {
    if (cur.trim() !== '') lists.push(cur.trim());
    cur = '';
  };
  const inString = () => {
    const top = stack[stack.length - 1];
    return top === 'double' || top === 'single' || top === 'tick';
  };

  let i = 0;
  const first = attrValue[0] ?? '';
  if (computed) {
    if (first === '"') stack.push('interpDouble');
    else if (first === "'") stack.push('interpSingle');
    else if (first === '{') stack.push('brace');
    else return lists; // the extension's lexer yields nothing for other openers
  } else {
    if (first === '"') stack.push('double');
    else if (first === "'") stack.push('single');
    else if (first === '{') stack.push('brace');
    else return lists;
  }
  i = 1;

  while (i < attrValue.length) {
    if (stack.length === 0) break; // attribute value ended
    const ch = attrValue[i];
    if (ch === undefined) break;
    const top = stack[stack.length - 1];

    if (top === 'arb') {
      if (ch === ']') {
        cur += ch;
        stack.pop();
        i++;
        if (stack.length === 0) break;
        continue;
      }
      if (/\s/.test(ch)) {
        // whitespace ends an arbitrary segment and flushes
        stack.pop();
        flush();
        i++;
        if (stack.length === 0) break;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    if (inString()) {
      const close = top === 'double' ? '"' : top === 'single' ? "'" : '`';
      if (ch === close) {
        flush();
        stack.pop();
        i++;
        if (stack.length === 0) break;
        continue;
      }
      if (ch === '{' && top !== 'tick') {
        flush();
        stack.push('brace');
        i++;
        continue;
      }
      if (ch === '$' && top === 'tick' && attrValue[i + 1] === '{') {
        flush();
        stack.push('brace');
        i += 2;
        continue;
      }
      if (ch === '}' && stack.length > 1) {
        flush();
        stack.pop();
        i++;
        continue;
      }
      if (ch === '[') {
        cur += ch;
        stack.push('arb');
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    // expression states: brace / interpDouble / interpSingle / interpTick / paren
    if (ch === "'" && (top === 'brace' || top === 'interpDouble' || top === 'paren')) {
      flush();
      stack.push('single');
      i++;
      continue;
    }
    if (ch === '"' && (top === 'brace' || top === 'interpSingle' || top === 'paren')) {
      flush();
      stack.push('double');
      i++;
      continue;
    }
    if (ch === '`' && top !== 'double' && top !== 'single') {
      flush();
      stack.push('tick');
      i++;
      continue;
    }
    if (ch === '{' && (top === 'brace' || top === 'interpDouble' || top === 'interpSingle')) {
      flush();
      stack.push('brace');
      i++;
      continue;
    }
    if (ch === '(' && top === 'paren') {
      flush();
      stack.push('paren');
      i++;
      continue;
    }
    if (ch === '}' && top === 'brace') {
      flush();
      stack.pop();
      i++;
      if (stack.length === 0) break;
      continue;
    }
    if (ch === ')' && top === 'paren') {
      flush();
      stack.pop();
      i++;
      if (stack.length === 0) break;
      continue;
    }
    if (ch === '"' && top === 'interpDouble') {
      flush();
      stack.pop();
      i++;
      if (stack.length === 0) break;
      continue;
    }
    if (ch === "'" && top === 'interpSingle') {
      flush();
      stack.pop();
      i++;
      if (stack.length === 0) break;
      continue;
    }
    if (ch === '`' && top === 'interpTick') {
      flush();
      stack.pop();
      i++;
      if (stack.length === 0) break;
      continue;
    }
    flush();
    i++;
  }
  flush();
  return lists;
}

function templateOf(content: string): { text: string; offset: number } | null {
  const start = content.indexOf('<template');
  const end = content.lastIndexOf('</template>');
  if (start < 0 || end < 0) return null;
  return { text: content.slice(start, end + '</template>'.length), offset: start };
}

function classListsOf(content: string): { line: number; classes: string[] }[] {
  const tpl = templateOf(content);
  if (tpl === null) return [];
  const tplStartLine = content.slice(0, tpl.offset).split('\n').length;
  const results: { line: number; classes: string[] }[] = [];
  const attrRe = /(\s|:|\()((?:v-bind:)?class)\s*=\s*(['"`{])/gi;
  for (const m of tpl.text.matchAll(attrRe)) {
    if (m.index === undefined) continue;
    const valueStart = m.index + m[0].length - 1; // at the opening quote/brace
    const rest = tpl.text.slice(valueStart);
    // the extension picks the lexer by the char before the attr name: ':' → computed
    const lists = extractClassLists(rest, m[1] === ':');
    const line = tplStartLine + tpl.text.slice(0, m.index).split('\n').length - 1;
    for (const list of lists) {
      const classes = list.split(/\s+/).filter(Boolean);
      if (classes.length > 0) results.push({ line, classes });
    }
  }
  return results;
}

// ---------- per-candidate compiled rule entries (nesting-aware) ----------

interface CfgNode {
  kind: 'decl' | 'rule' | 'atrule';
  decl?: string;
  selector?: string;
  name?: string;
  params?: string;
  children: CfgNode[];
}

function parseDeclsAndChildren(text: string, startIdx: number): { nodes: CfgNode[]; end: number } {
  const nodes: CfgNode[] = [];
  let i = startIdx;
  let buf = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const header = buf.trim();
      buf = '';
      const parsed = parseBlock(text, i + 1, header);
      nodes.push(parsed.node);
      i = parsed.end;
      continue;
    }
    if (ch === '}') {
      i++;
      return { nodes, end: i };
    }
    if (ch === ';') {
      const decl = buf.trim();
      buf = '';
      if (decl !== '') nodes.push({ kind: 'decl', decl, children: [] });
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  return { nodes, end: i };
}

function parseBlock(
  text: string,
  startIdx: number,
  header: string,
): { node: CfgNode; end: number } {
  const { nodes, end } = parseDeclsAndChildren(text, startIdx);
  if (header.startsWith('@')) {
    const sp = header.indexOf(' ');
    return {
      node: {
        kind: 'atrule',
        name: header.slice(0, sp < 0 ? undefined : sp),
        params: sp < 0 ? '' : header.slice(sp + 1),
        children: nodes,
      },
      end,
    };
  }
  return { node: { kind: 'rule', selector: header, children: nodes }, end };
}

const escapeClassName = (text: string): string => text.replace(/([^a-zA-Z0-9-_])/g, '\\$1');

const cssEntry = path.join(srcDir, 'styles', 'tailwind.css');
const css = readFileSync(cssEntry, 'utf8');
const compiler = await compile(css, {
  base: path.dirname(cssEntry),
  onDependency: () => {},
});
const designSystem = await __unstable__loadDesignSystem(css, { base: path.dirname(cssEntry) });

const entryCache = new Map<string, RuleEntry[]>();

function entriesFor(candidate: string): RuleEntry[] {
  const cached = entryCache.get(candidate);
  if (cached !== undefined) return cached;
  let entries: RuleEntry[] = [];
  try {
    const out = compiler.build([candidate]);
    const tree = parseDeclsAndChildren(out.replace(/\/\*[\s\S]*?\*\//g, ''), 0).nodes;
    const classSelector = `.${escapeClassName(candidate)}`;
    const selfContext = (node: CfgNode): string | null => {
      if (node.kind === 'atrule') return `${node.name ?? ''} ${node.params ?? ''}`.trim();
      const selector = (node.selector ?? '').replaceAll(classSelector, '&');
      return selector === '&' || selector === '' ? null : selector;
    };
    const walk = (nodes: CfgNode[], path: string[]) => {
      for (const node of nodes) {
        if (node.kind === 'decl') continue;
        const decls = node.children.filter((c) => c.kind === 'decl');
        if (decls.length > 0) {
          entries.push({
            properties: decls.map((d) => {
              const decl = d.decl ?? '';
              return decl.slice(0, decl.indexOf(':')).trim();
            }),
            context: [...path, selfContext(node)].filter(
              (c): c is string => c !== null && c !== '',
            ),
          });
        }
        const childPath =
          node.kind === 'atrule'
            ? [...path, `${node.name ?? ''} ${node.params ?? ''}`.trim()]
            : [...path, selfContext(node) ?? ''].filter((c): c is string => c !== '');
        walk(node.children, childPath);
      }
    };
    walk(tree, []);
  } catch {
    entries = [];
  }
  entryCache.set(candidate, entries);
  return entries;
}

const canonCache = new Map<string, string>();

function canonicalOf(candidate: string): string {
  const cached = canonCache.get(candidate);
  if (cached !== undefined) return cached;
  let canon = candidate;
  try {
    canon = designSystem.canonicalizeCandidates([candidate], { rem: 16 })[0] ?? candidate;
  } catch {
    canon = candidate;
  }
  canonCache.set(candidate, canon);
  return canon;
}

function equalArr(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------- analysis ----------

function scanTemplates(): { canonical: Finding[]; conflicts: Finding[] } {
  const canonical: Finding[] = [];
  const conflicts: Finding[] = [];

  for (const file of collectVueFiles(srcDir)) {
    const content = readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file).replaceAll('\\', '/');
    for (const { line, classes } of classListsOf(content)) {
      for (const candidate of classes) {
        const canon = canonicalOf(candidate);
        if (canon !== candidate) {
          canonical.push({
            file: rel,
            line,
            message: `\`${candidate}\` can be written as \`${canon}\``,
          });
        }
      }
      for (let i = 0; i < classes.length; i++) {
        const first = classes[i];
        if (first === undefined) continue;
        const a = entriesFor(first);
        if (a.length === 0) continue;
        const conflicting: string[] = [];
        for (let j = 0; j < classes.length; j++) {
          if (i === j) continue;
          const second = classes[j];
          if (second === undefined) continue;
          const b = entriesFor(second);
          if (a.length !== b.length) continue;
          let sameShape = true;
          let anyProps = false;
          for (let k = 0; k < a.length; k++) {
            const ea = a[k];
            const eb = b[k];
            if (ea === undefined || eb === undefined) {
              sameShape = false;
              break;
            }
            if (!equalArr(ea.properties, eb.properties) || !equalArr(ea.context, eb.context)) {
              sameShape = false;
              break;
            }
            if (ea.properties.length > 0) anyProps = true;
          }
          if (sameShape && anyProps) conflicting.push(second);
        }
        if (conflicting.length > 0) {
          conflicts.push({
            file: rel,
            line,
            message: `\`${first}\` applies the same CSS properties as ${conflicting
              .map((c) => `\`${c}\``)
              .join(', ')}`,
          });
        }
      }
    }
  }
  return { canonical, conflicts };
}

const findings = scanTemplates();

describe('tailwind class hygiene (mirrors Tailwind IntelliSense lint)', () => {
  it('every class is in its canonical form', () => {
    if (findings.canonical.length > 0) {
      expect.fail(findings.canonical.map((f) => `${f.file}:${f.line}  ${f.message}`).join('\n'));
    }
  });

  it('no two classes on one element set the same CSS properties', () => {
    if (findings.conflicts.length > 0) {
      expect.fail(findings.conflicts.map((f) => `${f.file}:${f.line}  ${f.message}`).join('\n'));
    }
  });
});
