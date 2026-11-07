import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { AppDefinition, FormStats } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { ChartBlock, TableBlock } from '../runtime/data-blocks';
import { RunContext } from '../runtime/run-context';
import { formTable } from './form-ops';

/**
 * Aba Respostas: resumo da versão publicada (abriram, enviaram, onde param), gráficos das perguntas de escolha e
 * a tabela de respostas — os mesmos blocos de tabela/gráfico dos mini apps (busca, Excel/PDF/CSV).
 */
@Component({
  selector: 'app-form-responses-tab',
  imports: [UI, LAYOUT, TableBlock, ChartBlock],
  providers: [RunContext],
  template: `
    @if (published(); as def) {
      <div class="stack stack--sections">
        <app-section layout="plain" title="Resumo" description="Versão publicada. Cada envio vira um registro da tabela Respostas.">
          <button actions uiButton (click)="reload()">Atualizar</button>
          @if (notice(); as n) { <ui-notice [error]="n.error">{{ n.text }}</ui-notice> }
          <div class="stats">
            <div class="stat"><span class="stat__label">Abriram</span><strong class="stat__value">{{ stats()?.opens ?? 0 }}</strong><span class="stat__hint">visitas ao link</span></div>
            <div class="stat"><span class="stat__label">Enviaram</span><strong class="stat__value">{{ stats()?.submissions ?? 0 }}</strong><span class="stat__hint">respostas completas</span></div>
            <div class="stat"><span class="stat__label">Taxa de conclusão</span><strong class="stat__value">{{ completion() }}</strong><span class="stat__hint">enviaram ÷ abriram</span></div>
          </div>
        </app-section>

        <div class="columns">
          <app-section title="Onde as pessoas param" description="Quantos chegaram a cada etapa. Perguntas puladas pela lógica recebem menos gente.">
            <ui-bar-chart [data]="funnel()" />
          </app-section>
          <div class="stack">
            @for (c of charts(); track c.field) {
              <app-chart-block [tableId]="tableId()" [groupBy]="c.field" [title]="c.title" />
            }
          </div>
        </div>

        <app-section layout="plain" title="Respostas" description="Busca, exportação e importação funcionam como nas tabelas dos mini apps.">
          <app-table-block [tableId]="tableId()" />
        </app-section>
      </div>
    } @else {
      <app-empty title="Ainda não publicado" text="Publique o formulário para receber respostas. Para testar, use Testar no topo: as respostas de teste ficam no rascunho." />
    }
  `,
})
export class FormResponsesTab {
  readonly appId = input.required<string>();
  /** Definição publicada (null = nunca publicado). */
  readonly published = input<AppDefinition | null>(null);
  private readonly api = inject(Api);
  private readonly ctx = inject(RunContext);

  protected readonly stats = signal<FormStats | null>(null);
  protected readonly notice = signal<Notice>(null);
  protected readonly tableId = computed(() => this.published()?.form?.tableId ?? '');
  protected readonly completion = computed(() => {
    const s = this.stats();
    return s && s.opens ? `${Math.round((s.submissions / s.opens) * 100)}%` : '—';
  });
  protected readonly funnel = computed(() => {
    const def = this.published();
    const s = this.stats();
    if (!def?.form || !s) return [];
    const title = new Map(def.form.questions.map((q, i) => [q.id, `${i + 1}. ${q.title || 'Sem título'}`]));
    return [
      { label: 'Abriram', value: s.opens },
      ...s.reached.map((r) => ({ label: title.get(r.questionId) ?? r.questionId, value: r.count })),
      { label: 'Enviaram', value: s.submissions },
    ];
  });
  /** Gráfico por pergunta de escolha, sim/não ou escala. */
  protected readonly charts = computed(() => {
    const def = this.published();
    if (!def?.form) return [];
    const fields = formTable(def).fields;
    return def.form.questions
      .map((q, i) => ({ q, i, field: fields.find((f) => f.id === q.fieldId) }))
      .filter((x) => x.field && (x.q.kind === 'choice' || x.q.kind === 'yesno' || x.q.kind === 'scale'))
      .map((x) => ({ field: x.field!.name, title: `${x.i + 1}. ${x.q.title}` }));
  });

  constructor() {
    effect(() => {
      const [id, def] = [this.appId(), this.published()];
      untracked(() => {
        this.ctx.appId.set(id);
        this.ctx.env.set('prod');
        this.ctx.canManage.set(true);
        this.ctx.definition.set(def);
        if (def) this.reload();
      });
    });
  }

  protected async reload() {
    try {
      this.stats.set(await this.api.formStats(this.appId()));
      this.ctx.refresh.update((n) => n + 1);
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    }
  }
}
