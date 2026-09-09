import {
  DEFAULT_SYSTEM_TEMPLATE,
  isFilledVariable,
  renderPromptTemplate,
} from '@lorekeeper/shared';
import { describe, expect, it } from 'vitest';

describe('prompt-variables renderer', () => {
  it('substitutes plain variables', () => {
    expect(
      renderPromptTemplate('Hello {{char}}, meet {{user}}.', { char: 'Vivienne', user: 'Julian' }),
    ).toBe('Hello Vivienne, meet Julian.');
  });

  it('renders the shipped default template without leaking section syntax (M4 fix)', () => {
    // Regression: the default template once closed its <Character> block with
    // an orphan {{/Character}} (no {{#Character}} opener), which the renderer
    // correctly left verbatim — so every prompt leaked "{{/Character}}".
    const rendered = renderPromptTemplate(DEFAULT_SYSTEM_TEMPLATE, {
      char: 'Vivienne',
      user: 'Julian',
      tagline: 'Victorian Occultist',
      description: 'Tall.',
      personality: 'Sharp.',
      behavior: 'Fidgets.',
      communicationStyle: 'Dry wit.',
      likes: 'Ledgers.',
      dislikes: 'Damp matches.',
      backstory: 'Heiress.',
      scenario: 'A haunted archive.',
      exampleDialogue: '',
      systemExtras: 'Period prose.',
      personaDescription: 'A scribe.',
      personaName: 'Julian',
    });
    expect(rendered).not.toMatch(/\{\{[#/]/); // no section markers survive
    expect(rendered).toContain('<Character>');
    expect(rendered).toContain('</Character>');
    expect(rendered).toContain('Tagline: Victorian Occultist'); // filled section kept
  });

  it('renders known-but-unset variables as empty strings; unknown names stay verbatim', () => {
    expect(renderPromptTemplate('A{{scenario}}B', {})).toBe('AB');
    expect(renderPromptTemplate('A{{notAVariable}}B', {})).toBe('A{{notAVariable}}B');
  });

  it('leaves unknown-syntax markers untouched (visible template bugs)', () => {
    expect(renderPromptTemplate('{{#orphan}}x{{nope}}', {})).toBe('{{#orphan}}x{{nope}}');
  });

  it('omits sections whose variable is empty and keeps filled ones', () => {
    const template = 'Intro\n{{#tagline}}Tagline: {{tagline}}{{/tagline}}\nOutro';
    expect(renderPromptTemplate(template, { tagline: '' })).toBe('Intro\n\nOutro');
    expect(renderPromptTemplate(template, { tagline: '  ' })).toBe('Intro\n\nOutro');
    expect(renderPromptTemplate(template, { tagline: 'Noir heirress' })).toBe(
      'Intro\nTagline: Noir heirress\nOutro',
    );
  });

  it('omits sections whose variable is missing entirely', () => {
    expect(renderPromptTemplate('a{{#gone}}X{{/gone}}b', {})).toBe('ab');
  });

  it('supports nested sections and inner variables', () => {
    const template = '{{#outer}}O {{#inner}}I:{{v}}{{/inner}} {{/outer}}end';
    expect(renderPromptTemplate(template, { outer: 'x', inner: '', v: '1' })).toBe('O  end');
    expect(renderPromptTemplate(template, { outer: 'x', inner: 'y', v: '1' })).toBe('O I:1 end');
  });

  it('tolerates whitespace in markers and keeps unterminated sections literal', () => {
    expect(renderPromptTemplate('{{ char }}!', { char: 'V' })).toBe('V!');
    expect(renderPromptTemplate('{{#open}}no close', { open: 'x' })).toBe('{{#open}}no close');
  });

  it('treats whitespace-only values as empty (isFilledVariable)', () => {
    expect(isFilledVariable('   ')).toBe(false);
    expect(isFilledVariable('x')).toBe(true);
    expect(isFilledVariable(undefined)).toBe(false);
    expect(isFilledVariable(null)).toBe(false);
  });
});
