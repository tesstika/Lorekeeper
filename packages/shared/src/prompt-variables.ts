// ---------------------------------------------------------------------------
// Mustache-style prompt template renderer (plan §4.1).
//
// Supports two constructs, intentionally tiny (no Handlebars dependency):
//   {{variable}}        → substituted with the variable's string value;
//                         missing/empty variables render as ''.
//   {{#name}}…{{/name}} → section: rendered (recursively) only when the
//                         variable `name` is a non-empty string; omitted
//                         entirely when it is missing, empty or whitespace.
//
// Unknown variables are left verbatim so template typos stay visible in the
// Settings editor instead of silently vanishing from prompts.
// ---------------------------------------------------------------------------

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/;
const SECTION_OPEN_PATTERN = /\{\{\s*#([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/;

/** The canonical variable set (mirrors Settings → Prompt Template cheat-sheet). */
const KNOWN_VARIABLES = new Set<string>([
  'char',
  'user',
  'tagline',
  'description',
  'personality',
  'behavior',
  'communicationStyle',
  'likes',
  'dislikes',
  'backstory',
  'scenario',
  'exampleDialogue',
  'systemExtras',
  'personaDescription',
  'personaName',
]);

export type PromptVariableValues = Record<string, string>;

/** A section is omitted when its variable is missing/empty/whitespace-only. */
export function isFilledVariable(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function findSectionClose(
  input: string,
  name: string,
  from: number,
): { start: number; end: number } | null {
  const closePattern = new RegExp(`\\{\\{\\s*/${name}\\s*\\}\\}`);
  const match = closePattern.exec(input.slice(from));
  if (!match || match.index === undefined) return null;
  const start = from + match.index;
  return { start, end: start + match[0].length };
}

/** Renders `{{#name}}…{{/name}}` sections (nested sections supported). */
function renderSections(input: string, vars: PromptVariableValues): string {
  let result = '';
  let cursor = 0;
  for (;;) {
    const openMatch = SECTION_OPEN_PATTERN.exec(input.slice(cursor));
    if (!openMatch || openMatch.index === undefined) {
      result += input.slice(cursor);
      return result;
    }
    const openStart = cursor + openMatch.index;
    const openEnd = openStart + openMatch[0].length;
    const name = openMatch[1] ?? '';
    result += input.slice(cursor, openStart);

    const close = findSectionClose(input, name, openEnd);
    if (!close) {
      // Unterminated section: keep it as literal text (visible template bug).
      result += openMatch[0];
      cursor = openEnd;
      continue;
    }
    const inner = input.slice(openEnd, close.start);
    if (isFilledVariable(vars[name])) {
      result += renderSections(inner, vars);
    }
    cursor = close.end;
  }
}

/**
 * Renders a prompt template: sections first (recursively), then plain
 * `{{variable}}` substitutions. Known variables missing from `vars` render as
 * ''; unknown names stay verbatim so template typos remain visible in prompts.
 */
export function renderPromptTemplate(template: string, vars: PromptVariableValues): string {
  const withoutSections = renderSections(template, vars);
  return withoutSections.replace(
    new RegExp(VARIABLE_PATTERN.source, 'g'),
    (match: string, name: string) => {
      if (typeof vars[name] === 'string') return vars[name] ?? '';
      return KNOWN_VARIABLES.has(name) ? '' : match;
    },
  );
}
