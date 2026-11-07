import { ActionDef, ActionType, AppDefinition, RunStep, WorkflowDef } from '../../core/models';
import { describeCondition, hasCondition } from '../builder/condition-ops';
import { scheduleLabel } from '../builder/editor-ops';

// Regras puras do editor de workflow (projeto) e da linha do tempo das execuções (testadas em flow-ops.spec.ts).
// Os passos são uma árvore: "se" (steps = então, else = senão) e "para cada" (steps por item) têm passos dentro.

export type StepType = 'callApi' | 'sendEmail' | 'if' | 'forEach' | 'wait' | 'transform';

export interface StepParam {
  key: string;
  label: string;
  mono?: boolean;
  textarea?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface StepSpec {
  label: string;
  icon: string;
  /** Prefixo do id gerado (api1, email2...). */
  idBase: string;
  params: StepParam[];
  /** Ações externas: têm tentativas e tempo limite. */
  action: boolean;
  /** Tem passos dentro (se / para cada). */
  container: boolean;
  defaultRetries: number;
}

export const STEPS: Record<StepType, StepSpec> = {
  callApi: {
    label: 'Chamar API', icon: 'callApi', idBase: 'api', action: true, container: false, defaultRetries: 3,
    params: [
      { key: 'method', label: 'Método', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', label: 'URL', mono: true, placeholder: 'https://erp.corp.local/api/...' },
      { key: 'headers', label: 'Cabeçalhos (um por linha)', mono: true, textarea: true, placeholder: 'Authorization: Bearer {{secrets.ERP_TOKEN}}' },
      { key: 'body', label: 'Corpo JSON', mono: true, textarea: true },
    ],
  },
  sendEmail: {
    label: 'Enviar e-mail', icon: 'sendEmail', idBase: 'email', action: true, container: false, defaultRetries: 2,
    params: [{ key: 'to', label: 'Para' }, { key: 'subject', label: 'Assunto' }, { key: 'body', label: 'Mensagem', textarea: true }],
  },
  if: { label: 'Se / senão', icon: 'condition', idBase: 'se', action: false, container: true, defaultRetries: 0, params: [] },
  forEach: {
    label: 'Para cada', icon: 'loop', idBase: 'cada', action: false, container: true, defaultRetries: 0,
    params: [
      { key: 'list', label: 'Lista', mono: true, placeholder: '{{steps.api1.body.itens}}' },
      { key: 'as', label: 'Nome do item', mono: true, placeholder: 'item' },
    ],
  },
  wait: { label: 'Esperar', icon: 'wait', idBase: 'espera', action: false, container: false, defaultRetries: 0, params: [{ key: 'seconds', label: 'Segundos (até 3600)' }] },
  transform: { label: 'Transformar', icon: 'transform', idBase: 'dados', action: false, container: false, defaultRetries: 0, params: [] },
};

export const PALETTE: { label: string; types: StepType[] }[] = [
  { label: 'Ações', types: ['callApi', 'sendEmail'] },
  { label: 'Lógica', types: ['if', 'forEach', 'wait', 'transform'] },
];

export const STEP_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const flowOf = (def: AppDefinition): WorkflowDef => def.workflows[0];

/** Todos os passos, em ordem de leitura (pai antes dos filhos; "então" antes de "senão"). */
export function allSteps(list: ActionDef[]): ActionDef[] {
  return list.flatMap((s) => [s, ...allSteps(s.steps ?? []), ...allSteps(s.else ?? [])]);
}

function uniqueId(def: AppDefinition, base: string): string {
  const taken = new Set(allSteps(flowOf(def).actions).map((s) => (s.id ?? '').toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export function newStep(def: AppDefinition, type: StepType): ActionDef {
  const spec = STEPS[type];
  const step: ActionDef = {
    type: type as ActionType, id: uniqueId(def, spec.idBase), params: {}, values: {}, steps: [], else: [], retries: spec.defaultRetries, timeoutSeconds: null,
  };
  if (type === 'callApi') step.params = { method: 'GET' };
  if (type === 'wait') step.params = { seconds: '60' };
  if (type === 'if') step.condition = { field: '', op: 'eq', value: '' };
  return step;
}

/** Onde está o passo: a lista que o contém, a posição e o caminho de pais (para variáveis de "para cada"). */
export function locate(list: ActionDef[], id: string, parents: ActionDef[] = []): { list: ActionDef[]; index: number; step: ActionDef; parents: ActionDef[] } | null {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.id === id) return { list, index: i, step: s, parents };
    const found = locate(s.steps ?? [], id, [...parents, s]) ?? locate(s.else ?? [], id, [...parents, s]);
    if (found) return found;
  }
  return null;
}

/** Paleta: dentro do "se"/"para cada" selecionado (no "então"), logo depois do passo selecionado, ou no fim. */
export function insertNear(def: AppDefinition, type: StepType, selectedId: string | null, branch: 'steps' | 'else' = 'steps'): ActionDef {
  const step = newStep(def, type);
  const root = flowOf(def).actions;
  const at = selectedId ? locate(root, selectedId) : null;
  if (!at) root.push(step);
  else if (STEPS[at.step.type as StepType]?.container) (at.step[branch] ??= []).push(step);
  else at.list.splice(at.index + 1, 0, step);
  return step;
}

export function removeStep(def: AppDefinition, id: string) {
  const at = locate(flowOf(def).actions, id);
  if (at) at.list.splice(at.index, 1);
}

export function moveStep(def: AppDefinition, id: string, delta: -1 | 1) {
  const at = locate(flowOf(def).actions, id);
  const j = (at?.index ?? -1) + delta;
  if (!at || j < 0 || j >= at.list.length) return;
  [at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]];
}

/** Troca o id e atualiza as referências {{steps.antigo.…}} nos outros passos. */
export function renameStep(def: AppDefinition, oldId: string, newId: string) {
  const at = locate(flowOf(def).actions, oldId);
  if (!at) return;
  at.step.id = newId;
  const from = `steps.${oldId}.`;
  const to = `steps.${newId}.`;
  const fix = (v: string | null | undefined) => (v ?? '').split(from).join(to);
  for (const s of allSteps(flowOf(def).actions)) {
    for (const k of Object.keys(s.params)) s.params[k] = fix(s.params[k]);
    for (const k of Object.keys(s.values)) s.values[k] = fix(s.values[k]);
    if (s.condition) {
      const c = s.condition;
      s.condition = { ...c, field: fix(c.field), value: fix(c.value), more: (c.more ?? []).map((r) => ({ ...r, field: fix(r.field), value: fix(r.value) })) };
    }
  }
}

/** Problema do id digitado (null = ok). */
export function idProblem(def: AppDefinition, currentId: string, value: string): string | null {
  if (!STEP_ID.test(value)) return 'Use letras, números e _ (começando por letra).';
  const taken = allSteps(flowOf(def).actions).some((s) => s.id !== currentId && (s.id ?? '').toLowerCase() === value.toLowerCase());
  return taken ? 'Já existe um passo com este id.' : null;
}

const OP: Record<string, string> = { eq: '=', neq: '≠', gt: '>', lt: '<', contains: 'contém', empty: 'vazio', notEmpty: 'preenchido' };

export function stepSummary(s: ActionDef): string {
  const p = s.params;
  switch (s.type) {
    case 'callApi': return p['url'] ? `${p['method'] ?? 'GET'} ${p['url']}` : 'Informe a URL';
    case 'sendEmail': return p['to'] ? `Para ${p['to']}` : 'Informe o destinatário';
    case 'if': return hasCondition(s.condition) ? describeCondition(s.condition, OP) : 'Informe a condição';
    case 'forEach': return p['list'] ? `${p['as'] || 'item'} em ${p['list']}` : 'Informe a lista';
    case 'wait': return `${p['seconds'] ?? '?'} s`;
    case 'transform': return Object.keys(s.values).join(', ') || 'Defina os campos';
    default: return s.type;
  }
}

/** Descrição do cron para os casos comuns; senão, a própria expressão. */
export function cronLabel(cron: string | null | undefined): string {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec((cron ?? '').trim());
  if (!m) return cron ? `Cron: ${cron}` : 'Informe a expressão cron';
  const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
  return m[3] === '1-5' ? `Dias úteis às ${time}` : `Todo dia às ${time}`;
}

export function flowTriggerSummary(t: WorkflowDef['trigger']): string {
  if (t.type === 'manual') return 'Botão "Executar agora"';
  if (t.type === 'webhook') return t.webhookKey ? 'POST no endereço do webhook' : 'Gere a chave do webhook';
  if (t.type === 'schedule') return t.frequency === 'cron' ? cronLabel(t.cron) : scheduleLabel(t);
  return t.type;
}

/** Variáveis disponíveis no passo selecionado (ou no fim): gatilho, saídas dos passos anteriores, item do "para cada", segredos. */
export function variablesAt(def: AppDefinition, selectedId: string | null): string[] {
  const wf = flowOf(def);
  const all = allSteps(wf.actions);
  const at = selectedId ? locate(wf.actions, selectedId) : null;
  const inside = new Set(at ? allSteps([at.step]).map((s) => s.id) : []);
  const stop = at ? all.indexOf(at.step) : all.length;
  const before = all.slice(0, stop).filter((s) => s.id && !inside.has(s.id) && !(at?.parents ?? []).includes(s));
  return [
    '{{trigger.now}}', '{{trigger.today}}',
    ...(wf.trigger.type === 'webhook' ? ['{{trigger.body.…}}'] : []),
    ...before.map((s) => `{{steps.${s.id}.…}}`),
    ...(at?.parents ?? []).filter((p) => p.type === 'forEach').map((p) => `{{${p.params['as'] || 'item'}.…}}`),
    '{{secrets.NOME}}',
  ];
}

// ---------- Execuções: resultado por passo (Testar) e linha do tempo (waterfall) ----------

export const RUN_STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'wait' | 'neutral' }> = {
  queued: { label: 'Na fila', tone: 'neutral' },
  running: { label: 'Rodando', tone: 'wait' },
  succeeded: { label: 'Sucesso', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'bad' },
  skipped: { label: 'Reaproveitado', tone: 'neutral' },
};

export const isDone = (status: string) => status === 'succeeded' || status === 'failed';

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1).replace('.', ',')} s`;
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Resultado de cada passo do editor (pelo id): status e duração; "para cada" pode ter rodado o mesmo passo várias vezes. */
export function resultsByStep(steps: RunStep[]): Record<string, { status: string; text: string }> {
  const out: Record<string, { status: string; text: string; count: number; ms: number }> = {};
  for (const s of steps) {
    if (!s.stepId) continue;
    const ms = (time(s.finishedAt) || Date.now()) - time(s.startedAt);
    const prev = out[s.stepId];
    const status = prev?.status === 'failed' || s.status === 'failed' ? 'failed' : s.status;
    out[s.stepId] = { status, count: (prev?.count ?? 0) + 1, ms: (prev?.ms ?? 0) + ms, text: '' };
  }
  return Object.fromEntries(Object.entries(out).map(([id, r]) => [
    id, { status: r.status, text: `${RUN_STATUS[r.status]?.label ?? r.status} · ${r.count > 1 ? `${r.count}× · ` : ''}${duration(r.ms)}` },
  ]));
}

export interface WaterfallRow {
  step: RunStep;
  leftPct: number;
  widthPct: number;
  durationText: string;
  startText: string;
}

/** Linha do tempo: cada trecho posicionado (início/largura em %) entre o primeiro início e o último fim da execução. */
export function waterfall(steps: RunStep[], now = Date.now()): { rows: WaterfallRow[]; totalMs: number } {
  if (!steps.length) return { rows: [], totalMs: 0 };
  const start = Math.min(...steps.map((s) => time(s.startedAt)));
  const end = Math.max(...steps.map((s) => time(s.finishedAt) || now));
  const total = Math.max(1, end - start);
  const rows = [...steps].sort((a, b) => a.order - b.order).map((s) => {
    const from = time(s.startedAt) - start;
    const ms = (time(s.finishedAt) || now) - time(s.startedAt);
    return {
      step: s, leftPct: (from / total) * 100, widthPct: Math.max(0.6, (ms / total) * 100), durationText: duration(ms), startText: `+${duration(from)}`,
    };
  });
  return { rows, totalMs: total };
}
