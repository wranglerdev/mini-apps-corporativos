import { AppDefinition, FieldDef, FormDef, JumpDef, QuestionDef, QuestionKind, TableDef } from '../../core/models';
import { newField, newId } from '../builder/editor-ops';
import { VarItem } from '../builder/variable-ops';
import { END, QUESTION_KINDS, YES_NO } from './form-flow';

// Operações puras do editor de formulário. Recebem a definição já clonada e a mutam (testadas em form-ops.spec.ts).
// Cada pergunta grava num campo da tabela de respostas: criar/remover/mudar o tipo da pergunta mexe no campo junto.

export const formOf = (def: AppDefinition): FormDef => def.form!;
export const formTable = (def: AppDefinition): TableDef => def.tables.find((t) => t.id === def.form!.tableId)!;
export const fieldOf = (def: AppDefinition, q: QuestionDef): FieldDef | undefined => formTable(def).fields.find((f) => f.id === q.fieldId);

const DEFAULT_OPTIONS = ['Opção 1', 'Opção 2'];

function uniqueName(table: TableDef, base: string): string {
  const taken = new Set(table.fields.map((f) => f.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function optionsFor(kind: QuestionKind, current: string[]): string[] {
  if (kind === 'yesno') return [...YES_NO];
  if (kind === 'choice') return current.length && current.join() !== YES_NO.join() ? current : [...DEFAULT_OPTIONS];
  return [];
}

/** Nova pergunta (e o campo dela) na posição `index` (padrão: no fim). */
export type RedirectMode = 'none' | 'url' | 'project';

/** Destino padrão da tela final: nenhum, link (aceita {{respostas}}) ou outro projeto do workspace. */
export const redirectMode = (f: FormDef): RedirectMode => (f.redirectProjectId != null ? 'project' : f.redirectUrl != null ? 'url' : 'none');

export function setRedirectMode(def: AppDefinition, mode: RedirectMode) {
  const f = formOf(def);
  f.redirectUrl = mode === 'url' ? (f.redirectUrl ?? '') : null;
  f.redirectProjectId = mode === 'project' ? (f.redirectProjectId ?? '') : null;
}

/** Nova regra de redirecionamento (condição sobre a 1ª pergunta; destino: projeto). */
export function addRedirectRule(def: AppDefinition) {
  const f = formOf(def);
  const first = f.questions[0] ? fieldOf(def, f.questions[0])?.name ?? '' : '';
  (f.redirectRules ??= []).push({ condition: { field: first, op: 'eq', value: '' }, projectId: '', url: null });
}

/**
 * Respostas que existem na pergunta (`questionId`; null = tela final): só as das perguntas anteriores. Usadas como
 * {{coluna}} no título, na descrição e na tela final (o runner troca pelo que a pessoa respondeu).
 */
export function answerVarsAt(def: AppDefinition, questionId: string | null): VarItem[] {
  const form = formOf(def);
  const index = questionId === null ? form.questions.length : form.questions.findIndex((q) => q.id === questionId);
  return form.questions.slice(0, Math.max(0, index)).flatMap((q, i) => {
    const f = fieldOf(def, q);
    if (!f) return [];
    return [{
      value: f.name, group: 'Respostas' as const, hint: `pergunta ${i + 1}`,
      about: `Resposta de "${q.title || f.name}". Vazia se a pessoa pulou essa pergunta pela lógica de pulo.`,
    }];
  });
}

export function addQuestion(def: AppDefinition, kind: QuestionKind, index?: number): QuestionDef {
  const table = formTable(def);
  const field = newField(uniqueName(table, 'Pergunta'), QUESTION_KINDS[kind].fieldType);
  field.options = optionsFor(kind, []);
  table.fields.push(field);
  const q: QuestionDef = { id: newId(), fieldId: field.id, kind, title: '', description: '', jumps: [] };
  const list = formOf(def).questions;
  list.splice(index ?? list.length, 0, q);
  return q;
}

/** Remove a pergunta, o campo dela e as regras que pulavam para ela. */
export function removeQuestion(def: AppDefinition, questionId: string) {
  const form = formOf(def);
  const q = form.questions.find((x) => x.id === questionId);
  if (!q) return;
  form.questions = form.questions.filter((x) => x.id !== questionId);
  const table = formTable(def);
  table.fields = table.fields.filter((f) => f.id !== q.fieldId);
  for (const other of form.questions) other.jumps = other.jumps.filter((j) => j.goTo !== questionId);
}

/** Troca o tipo: o campo acompanha (tipo e opções) e as regras de pulo são limpas (os valores mudam de sentido). */
export function setKind(def: AppDefinition, questionId: string, kind: QuestionKind) {
  const q = formOf(def).questions.find((x) => x.id === questionId);
  const field = q && fieldOf(def, q);
  if (!q || !field || q.kind === kind) return;
  q.kind = kind;
  q.jumps = [];
  field.type = QUESTION_KINDS[kind].fieldType;
  field.options = optionsFor(kind, field.options);
}

/** Sobe/desce a pergunta. Regras que passariam a pular para trás são removidas (pulos só vão para frente). */
export function moveQuestion(def: AppDefinition, questionId: string, delta: -1 | 1) {
  const list = formOf(def).questions;
  const i = list.findIndex((q) => q.id === questionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((q, index) => (q.jumps = q.jumps.filter((jump) => jump.goTo === END || list.findIndex((x) => x.id === jump.goTo) > index)));
}

/** Destinos possíveis de uma regra: perguntas seguintes ou o fim. */
export function jumpTargets(form: FormDef, questionId: string): { value: string; label: string }[] {
  const i = form.questions.findIndex((q) => q.id === questionId);
  return [
    ...form.questions.slice(i + 1).map((q, k) => ({ value: q.id, label: `${i + k + 2}. ${q.title || 'Sem título'}` })),
    { value: END, label: 'Tela final (enviar)' },
  ];
}

export function addJump(def: AppDefinition, questionId: string): JumpDef | null {
  const q = formOf(def).questions.find((x) => x.id === questionId);
  if (!q) return null;
  const targets = jumpTargets(formOf(def), questionId);
  const jump: JumpDef = { op: 'eq', value: q.kind === 'yesno' ? 'Não' : '', goTo: (targets[1] ?? targets[0]).value };
  q.jumps.push(jump);
  return jump;
}

export function removeJump(def: AppDefinition, questionId: string, index: number) {
  formOf(def).questions.find((x) => x.id === questionId)?.jumps.splice(index, 1);
}
