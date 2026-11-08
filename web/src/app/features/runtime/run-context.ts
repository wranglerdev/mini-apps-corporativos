import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthService } from '../../core/auth/auth';
import { AppDefinition, ComponentDef, Env, FieldDef, PagedRecords, Props, WorkflowResult } from '../../core/models';
import { evaluate, visibilityVars } from './visibility';
import { isInternal, isSafeLink } from './links';

/** Estado de execução de um app (provido por AppRunner). Blocos de dados injetam este contexto. */
@Injectable()
export class RunContext {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly appId = signal('');
  readonly env = signal<Env>('prod');
  readonly definition = signal<AppDefinition | null>(null);
  readonly canManage = signal(false);
  /** Valores dos componentes "input" da página, disponíveis como {{nome}} nos workflows. */
  readonly inputs = signal<Props>({});
  /** Incrementado após escritas: blocos recarregam seus dados. */
  readonly refresh = signal(0);
  readonly notice = signal<{ text: string; error: boolean } | null>(null);
  private readonly user = inject(AuthService).user;
  /** Variáveis das condições de visibilidade: inputs da página + user.*. */
  readonly vars = computed(() => visibilityVars(this.inputs(), this.user(), this.canManage()));

  isVisible(component: ComponentDef): boolean {
    return evaluate(component.visibleWhen, this.vars());
  }

  table(id: string | null | undefined) {
    return this.definition()?.tables.find((t) => t.id === id) ?? null;
  }

  setInput(name: string, value: string) {
    this.inputs.update((i) => ({ ...i, [name]: value }));
  }

  handle(result: WorkflowResult, fallback = '') {
    const text = [fallback, ...result.log].filter(Boolean).join(' ');
    this.notice.set(text ? { text, error: false } : null);
    this.refresh.update((v) => v + 1);
    if (result.navigateTo) this.navigate(result.navigateTo);
    if (result.openUrl) this.open(result.openUrl, !!result.openInNewTab);
  }

  /** Outro projeto (caminho do site, pelo roteador) ou link http(s); qualquer outra coisa é ignorada. */
  open(url: string, newTab: boolean) {
    if (!isSafeLink(url)) return;
    if (newTab) window.open(url, '_blank', 'noopener');
    else if (isInternal(url)) this.router.navigateByUrl(url);
    else window.location.assign(url);
  }

  fail(e: unknown) {
    this.notice.set({ text: errorMessage(e), error: true });
  }

  navigate(pageId: string) {
    this.router.navigate([], { queryParams: { page: pageId } });
  }

  async runWorkflow(workflowId: string) {
    try {
      this.handle(await this.api.runWorkflow(this.appId(), this.env(), workflowId, this.inputs()));
    } catch (e) {
      this.fail(e);
    }
  }

  /** id → rótulo (valor do primeiro campo) dos registros de uma tabela, para campos de relação. */
  async lookup(tableId: string): Promise<Map<string, string>> {
    const labels = await this.api.labels(this.appId(), this.env(), tableId);
    return new Map(labels.map((l) => [l.id, l.label]));
  }
}

export interface PageRequest {
  tableId: string | null | undefined;
  q: string;
  page: number;
  size: number;
}

/**
 * Página de registros consultada NO SERVIDOR. Refaz a consulta quando a requisição muda ou após escritas
 * (`refresh`). Respostas atrasadas de consultas antigas são descartadas. Chamar em contexto de injeção.
 */
export function useRecordPage(request: () => PageRequest): Signal<PagedRecords | null> {
  const ctx = inject(RunContext);
  const api = inject(Api);
  const result = signal<PagedRecords | null>(null);
  let latest = 0;
  effect(async () => {
    ctx.refresh();
    const r = request();
    if (!r.tableId) return;
    const mine = ++latest;
    try {
      const page = await api.queryRecords(ctx.appId(), ctx.env(), r.tableId, { q: r.q, page: r.page, size: r.size });
      if (mine === latest) result.set(page);
    } catch (e) {
      ctx.fail(e);
    }
  });
  return result;
}

/** Valor que acompanha `source` só depois de `ms` sem mudanças (ex.: busca enquanto digita). */
export function debounced<T>(source: () => T, ms: number): Signal<T> {
  const out = signal(untracked(source));
  effect((onCleanup) => {
    const value = source();
    const timer = setTimeout(() => out.set(value), ms);
    onCleanup(() => clearTimeout(timer));
  });
  return out;
}

/** Mapas id → rótulo para cada campo de relação (chave = nome do campo). */
export function useRelations(fields: () => FieldDef[]): Signal<Record<string, Map<string, string>>> {
  const ctx = inject(RunContext);
  const maps = signal<Record<string, Map<string, string>>>({});
  effect(async () => {
    ctx.refresh();
    const relations = fields().filter((f) => f.type === 'relation' && f.relationTableId);
    const result: Record<string, Map<string, string>> = {};
    for (const f of relations) result[f.name] = await ctx.lookup(f.relationTableId!);
    maps.set(result);
  });
  return maps;
}

/** Valor salvo em campo de arquivo: "{id}/{nome}". */
export const fileParts = (value: string) => {
  const i = value.indexOf('/');
  return { id: value.slice(0, i), name: value.slice(i + 1) };
};
