import {
  ActionDef, ActionType, AppDefinition, ComponentDef, ComponentType, FieldDef, FieldType, PageDef, ProjectKind, TableDef, WorkflowDef,
} from '../../core/models';
import { describeCondition } from './condition-ops';

// Operações puras do editor. Recebem a definição (já clonada pelo chamador) e a mutam.
// Toda regra do editor fica aqui para ser testável sem DOM (ver editor-ops.spec.ts).

export const newId = () => Math.random().toString(36).slice(2, 10);

export type EditorTab = 'design' | 'dados' | 'automacoes' | 'publicacao' | 'perguntas' | 'respostas' | 'compartilhar' | 'workflow' | 'execucoes' | 'segredos';

/** Abas do editor por tipo. A aba ativa fica na URL (?aba=) para sobreviver a reload e link compartilhado. */
export const EDITOR_TABS: Record<ProjectKind, { id: EditorTab; label: string }[]> = {
  app: [{ id: 'design', label: 'Design' }, { id: 'dados', label: 'Dados' }, { id: 'automacoes', label: 'Automações' }, { id: 'publicacao', label: 'Publicação' }],
  /** Formulário (DOCS/PRD-FORMS.md): perguntas, respostas e compartilhar; automações e publicação como nos apps. */
  form: [
    { id: 'perguntas', label: 'Perguntas' }, { id: 'respostas', label: 'Respostas' }, { id: 'compartilhar', label: 'Compartilhar' },
    { id: 'automacoes', label: 'Automações' }, { id: 'publicacao', label: 'Publicação' },
  ],
  /** Workflow (DOCS/PRD-WORKFLOWS.md): passos, execuções, segredos do workspace e publicação. */
  workflow: [{ id: 'workflow', label: 'Workflow' }, { id: 'execucoes', label: 'Execuções' }, { id: 'segredos', label: 'Segredos' }, { id: 'publicacao', label: 'Publicação' }],
};

/** Espera depois da última edição para salvar o rascunho sozinho. */
export const AUTOSAVE_MS = 2500;

/**
 * Há o que publicar? Sem versão publicada ou com alterações não salvas, sim; senão, só se o rascunho salvo for diferente
 * da versão em produção (as duas vêm do mesmo serializador do backend, então comparar o JSON basta).
 */
export function hasUnpublishedChanges(draft: AppDefinition, published: AppDefinition | null | undefined, dirty: boolean): boolean {
  return dirty || !published || JSON.stringify(draft) !== JSON.stringify(published);
}

/** Aba pedida na URL se existir para o tipo; senão a primeira do tipo. */
export function editorTab(kind: ProjectKind, requested: string | null | undefined): EditorTab {
  const tabs = EDITOR_TABS[kind] ?? EDITOR_TABS.app;
  return tabs.find((t) => t.id === requested)?.id ?? tabs[0].id;
}

/** Tipos de propriedade â†’ controle no painel de propriedades. */
export type PropKind = 'text' | 'textarea' | 'table' | 'field' | 'workflow' | 'anyWorkflow' | 'page' | 'select';

export interface PropSpec {
  key: string;
  label: string;
  kind: PropKind;
  options?: string[];
}

export const COMPONENTS: Record<ComponentType, { label: string; span: number; props: PropSpec[]; defaults: Record<string, string> }> = {
  text: {
    label: 'Texto', span: 12, defaults: { text: 'Texto', variant: 'body' },
    props: [{ key: 'text', label: 'Texto', kind: 'textarea' }, { key: 'variant', label: 'Estilo', kind: 'select', options: ['title', 'subtitle', 'body'] }],
  },
  button: {
    label: 'Botão', span: 3, defaults: { label: 'Enviar', variant: 'primary' },
    props: [
      { key: 'label', label: 'Rótulo', kind: 'text' },
      { key: 'workflowId', label: 'Automação ao clicar', kind: 'workflow' },
      { key: 'variant', label: 'Estilo', kind: 'select', options: ['primary', 'default', 'danger', 'ghost'] },
    ],
  },
  input: {
    label: 'Entrada', span: 6, defaults: { label: 'Campo', name: 'campo', inputType: 'text' },
    props: [
      { key: 'label', label: 'Rótulo', kind: 'text' },
      { key: 'name', label: 'Variável ({{nome}} nos workflows)', kind: 'text' },
      { key: 'placeholder', label: 'Placeholder', kind: 'text' },
      { key: 'inputType', label: 'Tipo', kind: 'select', options: ['text', 'number', 'date', 'email', 'textarea'] },
    ],
  },
  card: {
    label: 'Card', span: 4, defaults: { title: 'Título', text: 'Conteúdo' },
    props: [{ key: 'title', label: 'Título', kind: 'text' }, { key: 'text', label: 'Texto', kind: 'textarea' }],
  },
  form: {
    label: 'Formulário', span: 6, defaults: { label: 'Salvar' },
    props: [{ key: 'tableId', label: 'Tabela', kind: 'table' }, { key: 'title', label: 'Título', kind: 'text' }, { key: 'label', label: 'Rótulo do botão', kind: 'text' }],
  },
  table: {
    label: 'Tabela', span: 12, defaults: {},
    props: [{ key: 'tableId', label: 'Tabela', kind: 'table' }],
  },
  list: {
    label: 'Lista', span: 12, defaults: {},
    props: [
      { key: 'tableId', label: 'Tabela', kind: 'table' },
      { key: 'titleField', label: 'Campo do título', kind: 'field' },
      { key: 'subtitleField', label: 'Campo do subtítulo', kind: 'field' },
    ],
  },
  container: {
    label: 'Container', span: 12, defaults: { variant: 'card' },
    props: [{ key: 'title', label: 'Título (opcional)', kind: 'text' }, { key: 'variant', label: 'Estilo', kind: 'select', options: ['card', 'plain'] }],
  },
  chart: {
    label: 'Gráfico', span: 6, defaults: { title: 'Gráfico' },
    props: [{ key: 'tableId', label: 'Tabela', kind: 'table' }, { key: 'groupBy', label: 'Agrupar por', kind: 'field' }, { key: 'title', label: 'Título', kind: 'text' }],
  },
};

export const COMPONENT_TYPES = Object.keys(COMPONENTS) as ComponentType[];

/** Paleta "Inserir" do editor, agrupada como no Bubble. Cada tipo aparece uma vez. */
export const PALETTE_GROUPS: { label: string; types: ComponentType[] }[] = [
  { label: 'Básicos', types: ['text', 'button', 'card'] },
  { label: 'Entrada', types: ['input', 'form'] },
  { label: 'Dados', types: ['table', 'list', 'chart'] },
  { label: 'Layout', types: ['container'] },
];

export const MAX_DEPTH = 4;

export function newComponent(type: ComponentType): ComponentDef {
  const spec = COMPONENTS[type];
  const c: ComponentDef = { id: newId(), type, span: spec.span, props: { ...spec.defaults } };
  if (type === 'container') c.children = [];
  return c;
}

/** Todos os componentes da lista e de seus containers (pré-ordem). */
export function flatten(list: ComponentDef[]): ComponentDef[] {
  return list.flatMap((c) => [c, ...flatten(c.children ?? [])]);
}

/** Localiza um componente em qualquer nível: a lista que o contém, a posição e a profundidade (raiz = 1). */
export function findComponent(list: ComponentDef[], id: string, depth = 1): { component: ComponentDef; list: ComponentDef[]; index: number; depth: number } | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { component: list[i], list, index: i, depth };
    const inner = findComponent(list[i].children ?? [], id, depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** Lista de filhos do pai (null = raiz da página). */
function childrenOf(page: PageDef, parentId: string | null): ComponentDef[] | null {
  if (!parentId) return page.components;
  const parent = findComponent(page.components, parentId)?.component;
  return parent?.type === 'container' ? (parent.children ??= []) : null;
}

const depthOf = (page: PageDef, parentId: string | null) => (parentId ? findComponent(page.components, parentId)!.depth : 0);
const height = (c: ComponentDef): number => 1 + Math.max(0, ...(c.children ?? []).map(height));

/** Insere um novo componente no pai (null = página) na posição indicada. Retorna null se passaria do limite de níveis. */
export function insertComponent(page: PageDef, type: ComponentType, index?: number, parentId: string | null = null): ComponentDef | null {
  const list = childrenOf(page, parentId);
  if (!list || depthOf(page, parentId) + 1 > MAX_DEPTH) return null;
  const c = newComponent(type);
  list.splice(clamp(index ?? list.length, 0, list.length), 0, c);
  return c;
}

/**
 * Move um componente (com seus filhos) para outro pai/posição. `index` é a posição no destino antes da remoção,
 * como no drop "antes deste item". Recusa mover um container para dentro dele mesmo ou passar do limite de níveis.
 */
export function moveComponent(page: PageDef, id: string, parentId: string | null, index: number): boolean {
  const source = findComponent(page.components, id);
  if (!source) return false;
  if (parentId && (parentId === id || findComponent(source.component.children ?? [], parentId))) return false;
  const target = childrenOf(page, parentId);
  if (!target || depthOf(page, parentId) + height(source.component) > MAX_DEPTH) return false;

  source.list.splice(source.index, 1);
  const at = target === source.list && index > source.index ? index - 1 : index;
  target.splice(clamp(at, 0, target.length), 0, source.component);
  return true;
}

/** Cópia logo abaixo do original (mesmo pai), com ids novos em toda a subárvore. */
export function duplicateComponent(page: PageDef, id: string): ComponentDef | null {
  const found = findComponent(page.components, id);
  if (!found) return null;
  const copy = structuredClone(found.component);
  const renew = (c: ComponentDef) => {
    c.id = newId();
    c.children?.forEach(renew);
  };
  renew(copy);
  found.list.splice(found.index + 1, 0, copy);
  return copy;
}

/** Sobe (-1) ou desce (+1) uma posição dentro do mesmo pai. */
export function nudgeComponent(page: PageDef, id: string, delta: -1 | 1): boolean {
  const found = findComponent(page.components, id);
  const to = (found?.index ?? -1) + delta;
  if (!found || to < 0 || to >= found.list.length) return false;
  found.list.splice(found.index, 1);
  found.list.splice(to, 0, found.component);
  return true;
}

/** Caminho da raiz até o componente (inclusive). Vazio se não existir. */
export function pathTo(list: ComponentDef[], id: string): ComponentDef[] {
  for (const c of list) {
    if (c.id === id) return [c];
    const inner = pathTo(c.children ?? [], id);
    if (inner.length) return [c, ...inner];
  }
  return [];
}

/** Árvore achatada com profundidade (0 = raiz da página), para o painel Estrutura. */
export function outline(list: ComponentDef[], depth = 0): { component: ComponentDef; depth: number }[] {
  return list.flatMap((c) => [{ component: c, depth }, ...outline(c.children ?? [], depth + 1)]);
}

/** Resumo curto do conteúdo de um componente (rótulo no painel Estrutura). */
export function summary(c: ComponentDef, tableNames: Record<string, string>): string {
  const p = c.props;
  const text = p['text'] || p['label'] || p['title'] || (p['tableId'] ? tableNames[p['tableId']] : '') || '';
  return text.length > 28 ? text.slice(0, 27) + '…' : text;
}

export function removeComponent(page: PageDef, id: string) {
  const found = findComponent(page.components, id);
  found?.list.splice(found.index, 1);
}

export function addPage(def: AppDefinition, name = 'Nova página'): PageDef {
  const page: PageDef = { id: newId(), name, components: [] };
  def.pages.push(page);
  return page;
}

export function removePage(def: AppDefinition, id: string) {
  if (def.pages.length > 1) def.pages = def.pages.filter((p) => p.id !== id);
}

// ---------- Banco de dados ----------

export function addTable(def: AppDefinition, name: string): TableDef {
  const table: TableDef = {
    id: newId(), name, fields: [newField('Nome', 'text', true)],
    permissions: { userCanCreate: true, userCanEdit: false, userCanDelete: false }, webhookKey: null,
  };
  def.tables.push(table);
  return table;
}

export function newField(name: string, type: FieldType = 'text', required = false): FieldDef {
  return { id: newId(), name, type, required, buildersOnly: false, readOnly: false, options: type === 'select' ? ['Opção 1'] : [], relationTableId: null };
}

/** Remove a tabela e limpa referências (componentes, relações e workflows que apontavam para ela). */
export function removeTable(def: AppDefinition, id: string) {
  def.tables = def.tables.filter((t) => t.id !== id);
  for (const t of def.tables) t.fields = t.fields.filter((f) => f.relationTableId !== id || f.type !== 'relation');
  const prune = (list: ComponentDef[]): ComponentDef[] =>
    list.filter((c) => c.props['tableId'] !== id).map((c) => (c.children ? { ...c, children: prune(c.children) } : c));
  for (const p of def.pages) p.components = prune(p.components);
  def.workflows = def.workflows.filter((w) => w.trigger.tableId !== id);
}

/** "Formulários e listas gerados a partir das tabelas": cria página com formulário + tabela. */
export function generatePageForTable(def: AppDefinition, tableId: string): PageDef {
  const table = def.tables.find((t) => t.id === tableId)!;
  const page = addPage(def, table.name);
  const title = insertComponent(page, 'text')!;
  title.props = { text: table.name, variant: 'title' };
  insertComponent(page, 'form')!.props['tableId'] = tableId;
  insertComponent(page, 'table')!.props['tableId'] = tableId;
  page.components[1].span = 5;
  page.components[2].span = 7;
  return page;
}

// ---------- Workflows ----------

export const ACTIONS: Record<ActionType, { label: string; params: PropSpec[]; usesValues: boolean }> = {
  createRecord: { label: 'Criar registro', usesValues: true, params: [{ key: 'tableId', label: 'Tabela', kind: 'table' }] },
  updateRecord: {
    label: 'Atualizar registro', usesValues: true,
    params: [{ key: 'tableId', label: 'Tabela', kind: 'table' }, { key: 'recordId', label: 'Id do registro (padrão {{id}})', kind: 'text' }],
  },
  sendEmail: {
    label: 'Enviar e-mail', usesValues: false,
    params: [{ key: 'to', label: 'Para', kind: 'text' }, { key: 'subject', label: 'Assunto', kind: 'text' }, { key: 'body', label: 'Mensagem', kind: 'textarea' }],
  },
  callApi: {
    label: 'Chamar API (REST/webhook)', usesValues: false,
    params: [
      { key: 'method', label: 'Método', kind: 'select', options: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', label: 'URL', kind: 'text' },
      { key: 'body', label: 'Corpo JSON', kind: 'textarea' },
    ],
  },
  navigate: { label: 'Navegar para página', usesValues: false, params: [{ key: 'pageId', label: 'Página', kind: 'page' }] },
  startFlow: { label: 'Iniciar workflow', usesValues: false, params: [] },
  openLink: { label: 'Abrir projeto ou link', usesValues: false, params: [] },
  runWorkflow: {
    label: 'Executar outra automação', usesValues: false,
    params: [{ key: 'workflowId', label: 'Automação (recebe as mesmas variáveis)', kind: 'anyWorkflow' }],
  },
  requestApproval: {
    label: 'Solicitar aprovação', usesValues: false,
    params: [
      { key: 'approver', label: 'E-mail do aprovador', kind: 'text' },
      { key: 'title', label: 'Título', kind: 'text' },
      { key: 'statusField', label: 'Campo de status (padrão Status)', kind: 'text' },
    ],
  },
  if: { label: 'Se / senão', usesValues: false, params: [] },
  forEach: { label: 'Para cada', usesValues: false, params: [] },
  wait: { label: 'Esperar', usesValues: false, params: [] },
  transform: { label: 'Transformar', usesValues: false, params: [] },
};

/** Passos de controle dos projetos de workflow (features/flows): não aparecem nas automações de mini app. O Transformar aparece. */
const FLOW_ONLY: ActionType[] = ['if', 'forEach', 'wait'];

export const ACTION_TYPES = (Object.keys(ACTIONS) as ActionType[]).filter((t) => !FLOW_ONLY.includes(t));

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Descrição legível de um gatilho agendado (ex.: "Toda segunda às 09:30"). */
export function scheduleLabel(t: WorkflowDef['trigger']): string {
  if (t.type !== 'schedule') return '';
  switch (t.frequency) {
    case 'hourly': return 'A cada hora, no minuto 00';
    case 'daily': return t.time ? `Todo dia às ${t.time}` : 'Diário: escolha o horário';
    case 'weekly': {
      const day = t.dayOfWeek != null ? WEEKDAYS[t.dayOfWeek] : null;
      return day && t.time ? `Toda ${day} às ${t.time}`.replace('Toda domingo', 'Todo domingo').replace('Toda sábado', 'Todo sábado') : 'Semanal: escolha dia e horário';
    }
    default: return 'Escolha a frequência';
  }
}

export function addWorkflow(def: AppDefinition): WorkflowDef {
  const wf: WorkflowDef = { id: newId(), name: 'Novo workflow', trigger: { type: 'click', tableId: null }, condition: null, actions: [] };
  def.workflows.push(wf);
  return wf;
}

export function newAction(type: ActionType): ActionDef {
  return { type, params: type === 'callApi' ? { method: 'POST' } : {}, values: {}, ...(type === 'transform' ? { ops: [] } : {}) };
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// ---------- Nós do workflow (editor estilo n8n) ----------

export const TRIGGER_LABELS: Record<WorkflowDef['trigger']['type'], string> = {
  click: 'Clique em botão', recordCreated: 'Registro criado', recordUpdated: 'Registro atualizado', schedule: 'Agendado',
  manual: 'Manual', webhook: 'Webhook', call: 'Chamado por outro projeto',
};

const OP_TEXT: Record<string, string> = {
  eq: '=', neq: '≠', gt: '>', lt: '<', contains: 'contém', empty: 'está vazio', notEmpty: 'está preenchido',
};

const nameIn = (list: { id: string; name: string }[], id: string | null | undefined) => list.find((x) => x.id === id)?.name;

/** Linha de resumo do nó de gatilho. */
export function triggerSummary(def: AppDefinition, t: WorkflowDef['trigger']): string {
  if (t.type === 'click') return 'Ligado a um botão na aba Design';
  if (t.type === 'schedule') return scheduleLabel(t);
  const table = nameIn(def.tables, t.tableId);
  return table ? `Na tabela ${table}` : 'Escolha a tabela';
}

/** Linha de resumo do nó de condição ('' = sem condição: as ações rodam sempre). */
export function conditionSummary(c: WorkflowDef['condition']): string {
  return describeCondition(c, OP_TEXT);
}

/** Linha de resumo de um passo (ação). */
export function actionSummary(def: AppDefinition, a: ActionDef): string {
  const p = a.params;
  switch (a.type) {
    case 'createRecord':
    case 'updateRecord': {
      const table = nameIn(def.tables, p['tableId']);
      return table ? `Na tabela ${table}` : 'Escolha a tabela';
    }
    case 'sendEmail': return p['to'] ? `Para ${p['to']}` : 'Escolha o destinatário';
    case 'callApi': return p['url'] ? `${p['method'] ?? 'POST'} ${p['url']}` : 'Informe a URL';
    case 'navigate': return nameIn(def.pages, p['pageId']) ?? 'Escolha a página';
    case 'requestApproval': return p['approver'] ? `Aprovador ${p['approver']}` : 'Escolha o aprovador';
    case 'runWorkflow': return nameIn(def.workflows, p['workflowId']) ?? 'Escolha a automação';
    case 'startFlow': return p['flowId'] ? 'Workflow escolhido' : 'Escolha o workflow';
    case 'openLink': return p['projectId'] ? 'Abre outro projeto' : p['url'] ? `Abre ${p['url']}` : 'Escolha o destino';
    case 'transform': return [...new Set((a.ops ?? []).map((o) => o.target).filter(Boolean))].map((t) => `${t} ←`).join(', ') || 'Defina as operações';
    default: return ACTIONS[a.type]?.label ?? a.type;
  }
}
