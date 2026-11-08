import { ActionDef, AppDefinition, VariableDef, VariableType, WorkflowDef } from '../../core/models';
import { Suggestion } from '../../ui/completion';
import { flatten } from './editor-ops';

// Variáveis tipadas (Domain/Flows/Variables.cs), usadas nos projetos de workflow e nas automações de mini app/formulário.
// Regras puras, testadas em variable-ops.spec.ts e flow-ops.spec.ts.

export const VARIABLE_TYPES: Record<VariableType, { label: string; empty: string }> = {
  text: { label: 'Texto', empty: 'texto vazio' },
  number: { label: 'Número', empty: '0' },
  boolean: { label: 'Sim/não', empty: 'não' },
  date: { label: 'Data', empty: 'sem data' },
  list: { label: 'Lista', empty: '[]' },
  object: { label: 'Objeto', empty: '{}' },
};

export interface TransformOpSpec {
  label: string;
  group: string;
  /** Rótulo do argumento; sem ele, a operação só usa a entrada. */
  arg?: string;
  argPlaceholder?: string;
}

/** Operações do "Transformar" (mesmas chaves de TransformOps no back). */
export const TRANSFORM_OPS: Record<string, TransformOpSpec> = {
  set: { label: 'Definir valor', group: 'Geral' },
  default: { label: 'Se vazio, usar', group: 'Geral', arg: 'Valor se vazio' },
  upper: { label: 'Maiúsculas', group: 'Texto' },
  lower: { label: 'Minúsculas', group: 'Texto' },
  trim: { label: 'Tirar espaços', group: 'Texto' },
  append: { label: 'Juntar texto', group: 'Texto', arg: 'Texto no fim' },
  split: { label: 'Separar em lista', group: 'Texto', arg: 'Separador', argPlaceholder: ',' },
  add: { label: 'Somar', group: 'Número', arg: 'Número', argPlaceholder: '1' },
  subtract: { label: 'Subtrair', group: 'Número', arg: 'Número', argPlaceholder: '1' },
  multiply: { label: 'Multiplicar', group: 'Número', arg: 'Número', argPlaceholder: '2' },
  divide: { label: 'Dividir', group: 'Número', arg: 'Número', argPlaceholder: '2' },
  round: { label: 'Arredondar', group: 'Número', arg: 'Casas decimais', argPlaceholder: '0' },
  count: { label: 'Contar itens', group: 'Lista' },
  sum: { label: 'Somar itens', group: 'Lista' },
  first: { label: 'Primeiro item', group: 'Lista' },
  last: { label: 'Último item', group: 'Lista' },
  pluck: { label: 'Campo de cada item', group: 'Lista', arg: 'Campo', argPlaceholder: 'preco' },
  join: { label: 'Juntar em texto', group: 'Lista', arg: 'Separador', argPlaceholder: ', ' },
  get: { label: 'Pegar campo', group: 'Objeto', arg: 'Caminho', argPlaceholder: 'cliente.nome' },
  addDays: { label: 'Somar dias', group: 'Data', arg: 'Dias', argPlaceholder: '30' },
  formatDate: { label: 'Formatar data', group: 'Data', arg: 'Formato', argPlaceholder: 'dd/MM/yyyy' },
};

export const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = ['trigger', 'steps', 'secrets', 'user', 'now', 'today', 'id'];

export interface VarItem extends Suggestion {
  group: 'Variáveis' | 'Gatilho' | 'Registro' | 'Página' | 'Usuário' | 'Passos' | 'Item' | 'Segredos' | 'Respostas';
  /** Caminho dentro de um apelido (só no autocomplete, não no painel). */
  derived?: boolean;
  /** O básico para entender a variável (tooltip do painel). */
  about?: string;
  /** Valor quando vazia (só variáveis declaradas). */
  empty?: string;
}

const allActions = (list: ActionDef[]): ActionDef[] => list.flatMap((s) => [s, ...allActions(s.steps ?? []), ...allActions(s.else ?? [])]);

/** Variáveis declaradas que existem no ponto (`exists` diz se a origem do apelido já existe), com tooltip. */
export function declaredItems(wf: WorkflowDef, exists: (from: string) => boolean): VarItem[] {
  return (wf.variables ?? []).filter((v) => v.name && (!v.from || exists(v.from))).map((v) => ({
    value: v.name,
    group: 'Variáveis',
    hint: VARIABLE_TYPES[v.type]?.label + (v.from ? ` · ${v.from}` : ''),
    about: v.from
      ? `${VARIABLE_TYPES[v.type]?.label} · apelido de ${v.from}: acompanha o valor desse caminho.`
      : `${VARIABLE_TYPES[v.type]?.label} · variável; o Transformar grava nela.`,
    empty: v.default?.trim() ? v.default : VARIABLE_TYPES[v.type]?.empty,
  }));
}

/** Apelido herda os caminhos da origem: pedido → pedido.cliente.nome (de steps.api1.body.cliente.nome). */
export function aliasItems(wf: WorkflowDef, known: string[], exists: (from: string) => boolean): VarItem[] {
  const out: VarItem[] = [];
  for (const v of (wf.variables ?? []).filter((x) => x.name && x.from && exists(x.from))) {
    const from = `${v.from}.`.toLowerCase();
    for (const path of known.filter((k) => k.toLowerCase().startsWith(from)))
      out.push({ value: v.name + path.slice(from.length - 1), group: 'Variáveis', hint: `de ${v.name}`, derived: true });
  }
  return out;
}

const USER_ITEMS: VarItem[] = [
  { value: 'user.email', group: 'Usuário', hint: 'e-mail', about: 'E-mail de quem disparou a automação (no agendado, o sistema).' },
  { value: 'user.name', group: 'Usuário', hint: 'nome', about: 'Nome de quem disparou a automação.' },
  { value: 'user.department', group: 'Usuário', hint: 'departamento', about: 'Departamento de quem disparou a automação.' },
];

/** Nomes dos inputs de todas as páginas (contexto dos botões e textos), com a página de cada um. */
export function pageInputs(def: AppDefinition): { name: string; label: string; page: string }[] {
  const out = new Map<string, { name: string; label: string; page: string }>();
  for (const p of def.pages)
    for (const c of flatten(p.components))
      if (c.type === 'input' && c.props['name'] && !out.has(c.props['name']))
        out.set(c.props['name'], { name: c.props['name'], label: c.props['label'] || c.props['name'], page: p.name });
  return [...out.values()];
}

/**
 * O que existe no passo `index` de uma automação de mini app/formulário (WorkflowEngine): campos do registro do gatilho
 * (ou inputs da página no clique), now/today no agendado, user.*, api.status/api.response depois de um "Chamar API"
 * e as variáveis declaradas (apelido só onde a origem existe).
 */
export function automationVarsAt(def: AppDefinition, wf: WorkflowDef, index: number): VarItem[] {
  const t = wf.trigger;
  const table = def.tables.find((x) => x.id === t.tableId);
  const items: VarItem[] = [];
  if ((t.type === 'recordCreated' || t.type === 'recordUpdated') && table) {
    const what = def.form ? 'Resposta' : 'Campo';
    for (const f of table.fields) items.push({ value: f.name, group: def.form ? 'Respostas' : 'Registro', hint: f.type, about: `${what} "${f.name}" do registro que disparou (tabela ${table.name}).` });
    items.push({ value: 'id', group: def.form ? 'Respostas' : 'Registro', hint: 'id', about: 'Id do registro que disparou.' });
  }
  if (t.type === 'click')
    for (const i of pageInputs(def)) items.push({ value: i.name, group: 'Página', hint: i.page, about: `Campo "${i.label}" da página ${i.page}, enviado pelo botão.` });
  if (t.type === 'schedule')
    items.push(
      { value: 'now', group: 'Gatilho', hint: 'data e hora', about: 'Data e hora da execução agendada.' },
      { value: 'today', group: 'Gatilho', hint: 'data', about: 'Data da execução agendada (AAAA-MM-DD).' },
    );
  items.push(...USER_ITEMS);
  const before = wf.actions.slice(0, Math.max(0, index));
  const api = before.some((a) => a.type === 'callApi');
  if (api)
    items.push(
      { value: 'api.status', group: 'Passos', hint: 'Chamar API', about: 'Status HTTP do último "Chamar API" antes deste passo.' },
      { value: 'api.response', group: 'Passos', hint: 'Chamar API', about: 'Corpo da resposta do último "Chamar API" (texto; use um apelido do tipo objeto para ler os campos).' },
    );
  const known = new Set(items.map((i) => i.value.toLowerCase()));
  const exists = (from: string) => {
    const root = from.toLowerCase().split('.')[0];
    if (root === 'api') return api;
    return known.has(root) || known.has(from.toLowerCase());
  };
  return [...declaredItems(wf, exists), ...aliasItems(wf, items.map((i) => i.value), exists), ...items];
}

/** Propriedades de texto que o app renderiza com {{variáveis}} (runtime/visibility.ts, render). */
export const TEMPLATE_PROPS: Record<string, string[]> = { text: ['text'], card: ['title', 'text'], container: ['title'], button: ['label'] };

/**
 * Variáveis dos textos e da visibilidade no mini app: inputs das páginas (o valor digitado fica disponível em todas
 * as páginas depois de preenchido) e o usuário que está usando o app.
 */
export function pageVarItems(def: AppDefinition, pageId: string | null): VarItem[] {
  const page = def.pages.find((p) => p.id === pageId)?.name;
  const inputs: VarItem[] = pageInputs(def).map((i) => ({
    value: i.name, group: 'Página', hint: i.page,
    about: i.page === page
      ? `Valor digitado no campo "${i.label}" desta página. Vazio até a pessoa preencher.`
      : `Valor digitado no campo "${i.label}" da página ${i.page}. Vazio até a pessoa passar por lá.`,
  }));
  return [
    ...inputs.sort((a, b) => Number(b.hint === page) - Number(a.hint === page)),
    { value: 'user.name', group: 'Usuário', hint: 'nome', about: 'Nome de quem está usando o app.' },
    { value: 'user.email', group: 'Usuário', hint: 'e-mail', about: 'E-mail de quem está usando o app.' },
    { value: 'user.department', group: 'Usuário', hint: 'departamento', about: 'Departamento de quem está usando o app.' },
    { value: 'user.role', group: 'Usuário', hint: 'papel', about: 'Papel de quem está usando: admin, builder ou user.' },
    { value: 'user.canManage', group: 'Usuário', hint: 'true/false', about: '"true" se a pessoa gerencia este app; senão "false".' },
  ];
}

/** Problema da variável (null = ok). `taken`: nomes do contexto que ela esconderia (campos, inputs, item do "para cada"). */
export function variableProblem(wf: WorkflowDef, v: VariableDef, taken: string[] = []): string | null {
  if (!VAR_NAME.test(v.name)) return 'Use letras, números e _ (começando por letra).';
  if (RESERVED.includes(v.name.toLowerCase())) return 'Nome reservado.';
  if (taken.some((t) => t.toLowerCase() === v.name.toLowerCase())) return 'Já existe um campo, input ou item com este nome.';
  if ((wf.variables ?? []).filter((x) => x.name.toLowerCase() === v.name.toLowerCase()).length > 1) return 'Já existe uma variável com este nome.';
  if (v.from && /\{\{|\s/.test(v.from)) return 'O apelido é um caminho, sem {{ }} (ex.: steps.api1.body).';
  return defaultProblem(v.type, v.default);
}

function defaultProblem(type: VariableType, value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  if (!t) return null;
  const json = () => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  switch (type) {
    case 'number': return Number.isFinite(Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t)) ? null : 'O padrão precisa ser número.';
    case 'boolean': return ['true', 'false', 'sim', 'não', 'nao', '1', '0'].includes(t.toLowerCase()) ? null : 'Use sim ou não.';
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{2}\/\d{2}\/\d{4}/.test(t) ? null : 'Use AAAA-MM-DD.';
    case 'list': return Array.isArray(json()) ? null : 'Use uma lista JSON, ex.: ["a", "b"].';
    case 'object': {
      const o = json();
      return o && typeof o === 'object' && !Array.isArray(o) ? null : 'Use um objeto JSON, ex.: {"a": 1}.';
    }
    default: return null;
  }
}

/** Nova variável com nome único (base, base1, base2…). Com `from`, vira apelido do caminho. */
export function addVariable(wf: WorkflowDef, base = 'variavel', type: VariableType = 'text', from: string | null = null): VariableDef {
  const list = (wf.variables ??= []);
  const taken = new Set(list.map((v) => v.name.toLowerCase()));
  let name = base;
  for (let n = 1; taken.has(name.toLowerCase()); n++) name = `${base}${n}`;
  const v: VariableDef = { name, type, default: null, from };
  list.push(v);
  return v;
}

/**
 * Aplica `fix` a todo texto do workflow que pode citar {{variáveis}} (parâmetros, valores, condições, operações) e
 * `pathFix` aos campos que são caminho sem chaves (campo da condição e apelido).
 */
export function rewriteRefs(wf: WorkflowDef, fix: (v: string) => string, pathFix: (v: string) => string = fix) {
  const f = (v: string | null | undefined) => fix(v ?? '');
  const p = (v: string | null | undefined) => pathFix(fix(v ?? ''));
  const cond = (c: WorkflowDef['condition']) =>
    c ? { ...c, field: p(c.field), value: f(c.value), more: (c.more ?? []).map((r) => ({ ...r, field: p(r.field), value: f(r.value) })) } : c;
  wf.condition = cond(wf.condition);
  for (const s of allActions(wf.actions)) {
    for (const k of Object.keys(s.params)) s.params[k] = f(s.params[k]);
    for (const k of Object.keys(s.values)) s.values[k] = f(s.values[k]);
    for (const o of s.ops ?? []) Object.assign(o, { input: f(o.input), arg: f(o.arg) });
    if (s.condition) s.condition = cond(s.condition);
  }
  for (const v of wf.variables ?? []) if (v.from) v.from = p(v.from);
}

/** Renomeia e atualiza {{antigo}}, {{antigo.…}}, caminhos "antigo.…" nas condições/apelidos e o destino das operações. */
export function renameVariable(wf: WorkflowDef, oldName: string, newName: string) {
  const v = (wf.variables ?? []).find((x) => x.name === oldName);
  if (!v) return;
  v.name = newName;
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inTemplate = new RegExp(`\\{\\{(\\s*)${esc}(?=[.\\s}])`, 'g');
  const asPath = new RegExp(`^${esc}(?=\\.|$)`);
  rewriteRefs(wf, (t) => t.replace(inTemplate, `{{$1${newName}`), (t) => t.replace(asPath, newName));
  for (const s of allActions(wf.actions)) for (const o of s.ops ?? []) if (o.target === oldName) o.target = newName;
}

/** Remove a variável e as operações que gravavam nela (referências {{nome}} em texto passam a ficar vazias). */
export function removeVariable(wf: WorkflowDef, name: string) {
  wf.variables = (wf.variables ?? []).filter((v) => v.name !== name);
  for (const s of allActions(wf.actions)) if (s.ops) s.ops = s.ops.filter((o) => o.target !== name);
}
