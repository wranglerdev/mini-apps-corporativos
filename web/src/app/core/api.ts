import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  AppChanges, AppDetail, AppSummary, AppVersion, Approval, AuditEntry, CurrentUser, Env, FormStats, FormSubmitResult, FormView, GroupCount, ProjectKind,
  ImportResult, PagedRecords, RunDetail, SecretInfo, WorkflowRun, Props, RecordLabel, RecordWriteResult, RunView, StoredFile, Workspace, WorkflowResult,
} from './models';

/**
 * Único ponto de acesso HTTP ao backend. Autenticação é anexada pelo authInterceptor.
 * Se a URL base mudar no ambiente corporativo, altere apenas `base`.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  me = () => this.p(this.http.get<CurrentUser>(`${this.base}/me`));

  // Workspaces
  workspaces = () => this.p(this.http.get<Workspace[]>(`${this.base}/workspaces`));
  createWorkspace = (name: string, department: string) =>
    this.p(this.http.post<Workspace>(`${this.base}/workspaces`, { name, department }));

  // Apps
  apps = () => this.p(this.http.get<AppSummary[]>(`${this.base}/apps`));
  templates = () => this.p(this.http.get<AppSummary[]>(`${this.base}/apps/templates`));
  catalog = () => this.p(this.http.get<AppSummary[]>(`${this.base}/apps/catalog`));
  app = (id: string) => this.p(this.http.get<AppDetail>(`${this.base}/apps/${id}`));
  createApp = (workspaceId: string, name: string, templateId: string | null, kind: ProjectKind = 'app') =>
    this.p(this.http.post<AppDetail>(`${this.base}/apps`, { workspaceId, name, templateId, kind }));
  updateApp = (id: string, changes: AppChanges) => this.p(this.http.put<AppDetail>(`${this.base}/apps/${id}`, changes));
  deleteApp = (id: string) => this.p(this.http.delete<void>(`${this.base}/apps/${id}`));
  publish = (id: string) => this.p(this.http.post<AppVersion>(`${this.base}/apps/${id}/publish`, {}));
  versions = (id: string) => this.p(this.http.get<AppVersion[]>(`${this.base}/apps/${id}/versions`));
  rollback = (id: string, n: number) => this.p(this.http.post<AppDetail>(`${this.base}/apps/${id}/rollback/${n}`, {}));
  duplicate = (id: string, workspaceId: string, name?: string) =>
    this.p(this.http.post<AppDetail>(`${this.base}/apps/${id}/duplicate`, { workspaceId, name }));
  run = (slug: string) => this.p(this.http.get<RunView>(`${this.base}/run/${slug}`));

  // Registros (CRUD automático)
  /** Busca + paginação no servidor (size máx. 100). */
  queryRecords = (appId: string, env: Env, tableId: string, query: { q?: string; page?: number; size?: number }) =>
    this.p(this.http.get<PagedRecords>(this.rec(appId, env, tableId), {
      params: { q: query.q ?? '', page: query.page ?? 1, size: query.size ?? 20 },
    }));
  /** Contagem por valor de um campo, calculada no servidor (gráficos). */
  summary = (appId: string, env: Env, tableId: string, groupBy: string) =>
    this.p(this.http.get<GroupCount[]>(`${this.rec(appId, env, tableId)}/summary`, { params: { groupBy } }));
  /** id → rótulo dos registros de uma tabela (campos de relação). */
  labels = (appId: string, env: Env, tableId: string) =>
    this.p(this.http.get<RecordLabel[]>(`${this.rec(appId, env, tableId)}/labels`));
  createRecord = (appId: string, env: Env, tableId: string, data: Props) =>
    this.p(this.http.post<RecordWriteResult>(this.rec(appId, env, tableId), data));
  updateRecord = (appId: string, env: Env, tableId: string, id: string, data: Props) =>
    this.p(this.http.put<RecordWriteResult>(`${this.rec(appId, env, tableId)}/${id}`, data));
  deleteRecord = (appId: string, env: Env, tableId: string, id: string) =>
    this.p(this.http.delete<void>(`${this.rec(appId, env, tableId)}/${id}`));
  /** Exporta a tabela: csv e xlsx reimportáveis; pdf é relatório gerado no servidor. */
  exportRecords = (appId: string, env: Env, tableId: string, format: ExportFormat) =>
    this.p(this.http.get(`${this.rec(appId, env, tableId)}/export`, { params: { format }, responseType: 'blob' }));
  /** Importa .xlsx (primeira aba) ou .csv. */
  importRecords = (appId: string, env: Env, tableId: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return this.p(this.http.post<ImportResult>(`${this.rec(appId, env, tableId)}/import`, body));
  };

  // Workflows
  runWorkflow = (appId: string, env: Env, workflowId: string, context: Props) =>
    this.p(this.http.post<WorkflowResult>(`${this.base}/apps/${appId}/${env}/workflows/${workflowId}/run`, context));

  // Aprovações / auditoria / arquivos
  approvals = () => this.p(this.http.get<Approval[]>(`${this.base}/approvals`));
  decide = (id: string, approve: boolean, comment: string) =>
    this.p(this.http.post<Approval>(`${this.base}/approvals/${id}/decide`, { approve, comment }));
  audit = () => this.p(this.http.get<AuditEntry[]>(`${this.base}/audit`));
  uploadFile = (appId: string, env: Env, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return this.p(this.http.post<StoredFile>(`${this.base}/apps/${appId}/${env}/files`, body));
  };
  downloadFile = (appId: string, env: Env, id: string) =>
    this.p(this.http.get(`${this.base}/apps/${appId}/${env}/files/${id}`, { responseType: 'blob' }));
  // Formulários: link /f/{slug} (versão publicada) e rascunho para quem gerencia
  form = (slug: string) => this.p(this.http.get<FormView>(`${this.base}/forms/${slug}`));
  submitForm = (slug: string, answers: Props, website = '') =>
    this.p(this.http.post<FormSubmitResult>(`${this.base}/forms/${slug}/responses`, { answers, website }));
  formEvent = (slug: string, key: string) => this.p(this.http.post<void>(`${this.base}/forms/${slug}/events`, { key }));
  formDraft = (appId: string) => this.p(this.http.get<FormView>(`${this.base}/apps/${appId}/form/draft`));
  submitFormDraft = (appId: string, answers: Props) =>
    this.p(this.http.post<FormSubmitResult>(`${this.base}/apps/${appId}/form/draft/responses`, { answers }));
  formStats = (appId: string) => this.p(this.http.get<FormStats>(`${this.base}/apps/${appId}/form/stats`));
  /** Link do formulário publicado (para o builder copiar). */
  formUrl = (slug: string) => `${location.origin}/f/${slug}`;

  // Workflows (projetos): execuções e segredos do workspace
  runs = (appId: string, env: Env) => this.p(this.http.get<WorkflowRun[]>(`${this.base}/apps/${appId}/${env}/runs`));
  runNow = (appId: string, env: Env) => this.p(this.http.post<WorkflowRun>(`${this.base}/apps/${appId}/${env}/runs`, {}));
  runDetail = (appId: string, env: Env, runId: string) => this.p(this.http.get<RunDetail>(`${this.base}/apps/${appId}/${env}/runs/${runId}`));
  rerun = (appId: string, env: Env, runId: string, fromStepId: string | null) =>
    this.p(this.http.post<WorkflowRun>(`${this.base}/apps/${appId}/${env}/runs/${runId}/rerun`, { fromStepId }));
  secrets = (workspaceId: string) => this.p(this.http.get<SecretInfo[]>(`${this.base}/workspaces/${workspaceId}/secrets`));
  setSecret = (workspaceId: string, name: string, value: string) =>
    this.p(this.http.put<void>(`${this.base}/workspaces/${workspaceId}/secrets`, { name, value }));
  deleteSecret = (workspaceId: string, name: string) =>
    this.p(this.http.delete<void>(`${this.base}/workspaces/${workspaceId}/secrets/${encodeURIComponent(name)}`));
  /** URL do gatilho webhook de um workflow (para o builder copiar). */
  flowWebhookUrl = (appId: string) => `${location.origin}${this.base}/hooks/wf/${appId}`;

  /** URL pública do webhook de entrada de uma tabela (para o builder copiar). */
  webhookUrl = (appId: string, tableId: string) => `${location.origin}${this.base}/hooks/${appId}/${tableId}`;

  private rec = (appId: string, env: Env, tableId: string) => `${this.base}/apps/${appId}/${env}/tables/${tableId}/records`;
  private p = <T>(o: Observable<T>) => firstValueFrom(o);
}

export type ExportFormat = 'xlsx' | 'pdf' | 'csv';

/** Mensagem amigável a partir de erro HTTP (ProblemDetails.title) ou exceção. */
export function errorMessage(e: unknown): string {
  const err = e as { error?: { title?: string }; message?: string };
  return err?.error?.title ?? err?.message ?? 'Erro inesperado.';
}

/** Baixa um Blob como arquivo (sem depender de cookies: funciona com qualquer esquema de auth). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
