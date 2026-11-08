// Tipos espelhados do backend (api/src/Domain). Mantenha em sincronia com os DTOs da API.

export type Role = 'user' | 'builder' | 'admin';
export type Env = 'draft' | 'prod';

export interface CurrentUser {
  email: string;
  name: string;
  role: Role;
  department: string;
}

export interface Workspace {
  id: string;
  name: string;
  department: string;
}

export interface AppSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  publishedVersion: number | null;
  isTemplate: boolean;
  inCatalog: boolean;
  updatedAt: string;
  /** Primeiros componentes da 1ª página (rascunho para quem gerencia, publicada no catálogo): miniatura. */
  sketch: { type: ComponentType; span: number }[];
  kind: ProjectKind;
}

/** Tipo do projeto (derivado da definição no backend: com `form` = formulário). */
export type ProjectKind = 'app' | 'form' | 'workflow';

export interface AppDetail extends Omit<AppSummary, 'sketch'> {
  draft: AppDefinition;
  published: AppDefinition | null;
  allowedDepartments: string[];
  createdBy: string;
}

export interface AppChanges {
  name: string;
  description: string;
  draft: AppDefinition;
  inCatalog: boolean;
  isTemplate: boolean;
  allowedDepartments: string[];
}

export interface AppDefinition {
  pages: PageDef[];
  tables: TableDef[];
  workflows: WorkflowDef[];
  /** Só em formulários. */
  form?: FormDef | null;
  /** Projeto do tipo workflow (sem páginas, um workflow em segundo plano). */
  automation?: boolean;
}

// ---------- Formulários (DOCS/PRD-FORMS.md) ----------

export type QuestionKind = 'short' | 'long' | 'email' | 'number' | 'date' | 'choice' | 'yesno' | 'scale' | 'file';

/** "Se a resposta [op] [value], ir para [goTo]" (id de pergunta seguinte ou "end"). */
export interface JumpDef {
  op: ConditionOp;
  value: string | null;
  goTo: string;
}

export interface QuestionDef {
  id: string;
  fieldId: string;
  kind: QuestionKind;
  title: string;
  description: string;
  jumps: JumpDef[];
}

export interface FormDef {
  tableId: string;
  questions: QuestionDef[];
  welcomeTitle: string;
  welcomeText: string;
  endTitle: string;
  endText: string;
  redirectUrl: string | null;
  public: boolean;
}

export interface FormView {
  appId: string;
  name: string;
  slug: string;
  env: Env;
  version: number | null;
  form: FormDef;
  fields: FieldDef[];
}

export interface FormSubmitResult {
  recordId: string | null;
  endTitle: string;
  endText: string;
  redirectUrl: string | null;
}

export interface FormStats {
  opens: number;
  submissions: number;
  reached: { questionId: string; count: number }[];
}

export interface PageDef {
  id: string;
  name: string;
  components: ComponentDef[];
}

export type ComponentType = 'text' | 'button' | 'input' | 'table' | 'list' | 'card' | 'form' | 'chart' | 'container';
export type Props = Record<string, string | null>;

export interface ComponentDef {
  id: string;
  type: ComponentType;
  /** Colunas ocupadas num grid de 12 (no celular, sempre 12). */
  span: number;
  props: Props;
  /** Só em "container": componentes dentro (grade própria de 12 colunas). */
  children?: ComponentDef[];
  /** Mostrar só quando a condição for verdadeira. Apresentação apenas, não segurança. */
  visibleWhen?: ConditionDef | null;
}

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'relation' | 'file';

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  buildersOnly: boolean;
  /** Usuários veem mas não editam. */
  readOnly: boolean;
  options: string[];
  relationTableId: string | null;
}

export interface TablePermissions {
  userCanCreate: boolean;
  userCanEdit: boolean;
  userCanDelete: boolean;
}

export interface TableDef {
  id: string;
  name: string;
  fields: FieldDef[];
  permissions: TablePermissions;
  /** Chave do webhook de entrada; null = desligado. */
  webhookKey: string | null;
}

export type TriggerType = 'click' | 'recordCreated' | 'recordUpdated' | 'schedule' | 'manual' | 'webhook';
export type Frequency = 'hourly' | 'daily' | 'weekly' | 'cron';
export type ActionType = 'createRecord' | 'updateRecord' | 'sendEmail' | 'callApi' | 'navigate' | 'requestApproval' | 'runWorkflow'
  | 'if' | 'forEach' | 'wait' | 'transform';
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'empty' | 'notEmpty';

export type ConditionJoin = 'and' | 'or';

export interface ConditionRule {
  field: string;
  op: ConditionOp;
  value: string | null;
}

/** 1ª regra nos próprios campos (o formato antigo continua valendo); demais em `more`. join 'or' = basta uma. */
export interface ConditionDef extends ConditionRule {
  join?: ConditionJoin;
  more?: ConditionRule[];
}

export interface ActionDef {
  type: ActionType;
  params: Props;
  values: Props;
  // Projetos de workflow (passos): id (saída em {{steps.id.*}}), aninhamento, tentativas e tempo limite.
  id?: string | null;
  condition?: ConditionDef | null;
  steps?: ActionDef[];
  else?: ActionDef[];
  retries?: number;
  timeoutSeconds?: number | null;
  /** "transform": operações em ordem; cada uma grava numa variável do workflow. */
  ops?: TransformOp[];
}

/** Variável do workflow (Domain/Flows/Variables.cs): usada como {{nome}}. */
export type VariableType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object';

export interface VariableDef {
  name: string;
  type: VariableType;
  /** Valor quando vazia (lista/objeto em JSON). Vazio = vazio do tipo. */
  default?: string | null;
  /** Apelido: caminho do contexto (ex.: steps.api1.body.cliente). O valor acompanha o caminho. */
  from?: string | null;
}

export interface TransformOp {
  target: string;
  op: string;
  input?: string | null;
  arg?: string | null;
}

export interface WorkflowDef {
  id: string;
  name: string;
  trigger: {
    type: TriggerType;
    tableId: string | null;
    /** Agendado: frequência, horário "HH:mm" (diário/semanal) e dia 0-6 (semanal, 0 = domingo). */
    frequency?: Frequency | null;
    time?: string | null;
    dayOfWeek?: number | null;
    /** Frequency = 'cron': "min hora dia mês dia-da-semana". */
    cron?: string | null;
    /** Gatilho webhook (projetos de workflow). */
    webhookKey?: string | null;
  };
  condition: ConditionDef | null;
  actions: ActionDef[];
  /** Só em projetos de workflow. */
  variables?: VariableDef[];
}

export interface DataRecord {
  id: string;
  data: Props;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Página de registros vinda do servidor (busca e paginação no backend). */
export interface PagedRecords {
  items: DataRecord[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface GroupCount {
  label: string | null;
  value: number;
}

export interface RecordLabel {
  id: string;
  label: string;
}

export interface WorkflowResult {
  navigateTo: string | null;
  log: string[];
}

export interface RecordWriteResult {
  record: DataRecord;
  workflow: WorkflowResult;
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

export interface RunView {
  appId: string;
  name: string;
  slug: string;
  version: number | null;
  definition: AppDefinition;
  canManage: boolean;
}

export interface AppVersion {
  id: string;
  appId: string;
  number: number;
  publishedBy: string;
  publishedAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  appId: string;
  title: string;
  approver: string;
  requestedBy: string;
  status: ApprovalStatus;
  comment: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
}

export interface StoredFile {
  id: string;
  name: string;
}

// ---------- Execuções de workflow (DOCS/PRD-WORKFLOWS.md) ----------

export type RunStatusValue = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string;
  appId: string;
  env: Env;
  workflowId: string;
  number: number;
  version: number | null;
  status: RunStatusValue;
  trigger: string;
  triggerData: string;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  startFromStepId: string | null;
  sourceRunId: string | null;
}

export interface RunStep {
  id: string;
  runId: string;
  parentId: string | null;
  order: number;
  depth: number;
  stepId: string | null;
  name: string;
  /** Tipo da ação, ou attempt | backoff | item. */
  type: string;
  status: RunStatusValue;
  startedAt: string;
  finishedAt: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
}

export interface RunDetail {
  run: WorkflowRun;
  steps: RunStep[];
}

export interface SecretInfo {
  name: string;
  updatedBy: string;
  updatedAt: string;
}
