// Autocomplete de variáveis do ui-input (testado em completion.spec.ts).
// 'template': completa o que vem depois do último "{{" aberto antes do cursor (texto livre com {{variáveis}}).
// 'path': o campo todo é um caminho (ex.: apelido "steps.api1.body"), sem {{ }}.

export interface Suggestion {
  value: string;
  hint?: string;
}

export type CompleteMode = 'template' | 'path';

export function completionAt(text: string, caret: number, mode: CompleteMode): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  if (mode === 'path') return /\s/.test(before.trim()) ? null : { start: 0, query: before.trim() };
  const open = before.lastIndexOf('{{');
  if (open < 0 || before.indexOf('}}', open) >= 0) return null;
  const query = before.slice(open + 2).trim();
  return /\s/.test(query) ? null : { start: open, query };
}

/** Começa com o que foi digitado primeiro; depois as que contêm. Sem acento/maiúscula. */
export function filterSuggestions(list: Suggestion[], query: string, max = 8): Suggestion[] {
  const q = fold(query);
  const starts = list.filter((s) => fold(s.value).startsWith(q));
  const contains = list.filter((s) => !fold(s.value).startsWith(q) && fold(s.value).includes(q));
  return [...starts, ...contains].filter((s) => fold(s.value) !== q).slice(0, max);
}

/** Troca o trecho em edição pela sugestão (fechando com }}) e diz onde fica o cursor. */
export function applyCompletion(text: string, caret: number, mode: CompleteMode, value: string): { text: string; caret: number } {
  if (mode === 'path') return { text: value, caret: value.length };
  const at = completionAt(text, caret, mode);
  if (!at) return { text, caret };
  const token = `{{${value}}}`;
  const rest = text.slice(caret).replace(/^[\w.]*\s*\}\}/, '');
  return { text: text.slice(0, at.start) + token + rest, caret: at.start + token.length };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
