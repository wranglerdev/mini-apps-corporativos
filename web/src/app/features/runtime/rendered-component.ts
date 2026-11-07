import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { ComponentDef, FieldType, TableDef } from '../../core/models';
import { UI, UiRow } from '../../ui/ui';
import { COMPONENTS } from '../builder/editor-ops';
import { ChartBlock, ListBlock, TableBlock } from './data-blocks';
import { FormBlock } from './form-block';
import { RunContext } from './run-context';

/**
 * Renderiza um ComponentDef (containers renderizam os filhos recursivamente, respeitando a visibilidade).
 * Runtime: design=false. Editor: design=true, blocos de dados viram prévias com dados de exemplo do schema.
 */
@Component({
  selector: 'app-rendered',
  imports: [UI, FormBlock, TableBlock, ListBlock, ChartBlock, NgTemplateOutlet],
  template: `
    @let c = component();
    @let p = c.props;
    @switch (c.type) {
      @case ('text') {
        <p [class]="'text-' + (p['variant'] || 'body')">{{ p['text'] }}</p>
      }
      @case ('button') {
        <button uiButton [variant]="p['variant'] || 'primary'" (click)="click()">{{ p['label'] || 'Botão' }}</button>
      }
      @case ('input') {
        <ui-input [label]="p['label'] ?? ''" [type]="p['inputType'] || 'text'" [placeholder]="p['placeholder'] ?? ''"
          [value]="ctx?.inputs()?.[p['name'] ?? ''] ?? ''" (valueChange)="ctx?.setInput(p['name'] ?? '', $event)" />
      }
      @case ('container') {
        @if (p['variant'] === 'plain') {
          <div class="box-plain">
            @if (p['title']) { <h3 class="box-plain__title">{{ p['title'] }}</h3> }
            <ng-container *ngTemplateOutlet="children; context: { $implicit: c.children ?? [] }" />
          </div>
        } @else {
          <ui-card [title]="p['title']">
            <ng-container *ngTemplateOutlet="children; context: { $implicit: c.children ?? [] }" />
          </ui-card>
        }
      }
      @case ('card') {
        <ui-card [title]="p['title']"><p class="text-body">{{ p['text'] }}</p></ui-card>
      }
      @default {
        @if (design() || !ctx) {
          <!-- Prévia no editor: mesma aparência do app, com dados de exemplo tirados do schema da tabela -->
          @let t = table();
          @if (!t) {
            <div class="placeholder"><strong>{{ label() }}</strong>Escolha uma tabela nas propriedades.</div>
          } @else {
            @switch (c.type) {
              @case ('form') {
                <ui-card [title]="p['title'] || 'Novo em ' + t.name">
                  @for (f of formFields(); track f.id) {
                    <ui-input [label]="f.name" [required]="f.required" [placeholder]="sample(f.type, f.options)" />
                  }
                  <button uiButton variant="primary">{{ p['label'] || 'Salvar' }}</button>
                </ui-card>
              }
              @case ('table') {
                <ui-card [title]="t.name">
                  <ui-table [columns]="columns()" [rows]="sampleRows()" />
                </ui-card>
              }
              @case ('list') {
                <div class="list-cards">
                  @for (n of [1, 2, 3]; track n) {
                    <ui-card [title]="(p['titleField'] || t.fields[0]?.name || 'Item') + ' ' + n">
                      <p class="muted">{{ p['subtitleField'] || 'Subtítulo' }}</p>
                    </ui-card>
                  }
                </div>
              }
              @case ('chart') {
                <ui-card [title]="p['title'] || 'Gráfico'">
                  <ui-bar-chart [data]="sampleBars()" />
                </ui-card>
              }
            }
          }
        } @else if (p['tableId']) {
          @switch (c.type) {
            @case ('form') { <app-form-block [tableId]="p['tableId']!" [title]="p['title']" [submitLabel]="p['label']" /> }
            @case ('table') { <app-table-block [tableId]="p['tableId']!" /> }
            @case ('list') { <app-list-block [tableId]="p['tableId']!" [titleField]="p['titleField'] ?? ''" [subtitleField]="p['subtitleField'] ?? ''" /> }
            @case ('chart') { <app-chart-block [tableId]="p['tableId']!" [groupBy]="p['groupBy'] ?? ''" [title]="p['title'] ?? ''" /> }
          }
        }
      }
    }
    <ng-template #children let-list>
      <div class="grid">
        @for (child of list; track child.id) {
          @if (design() || !ctx || ctx.isVisible(child)) {
            <div class="cell" [style.--span]="child.span">
              <app-rendered [component]="child" [design]="design()" [tables]="tables()" />
            </div>
          }
        }
      </div>
    </ng-template>
  `,
})
export class RenderedComponent {
  readonly component = input.required<ComponentDef>();
  readonly design = input(false);
  /** Tabelas do app por id (no editor, para as prévias; no runtime vem do RunContext). */
  readonly tables = input<Record<string, TableDef>>({});
  protected readonly ctx = inject(RunContext, { optional: true });

  protected readonly label = computed(() => COMPONENTS[this.component().type].label);
  protected readonly table = computed<TableDef | null>(() => {
    const id = this.component().props['tableId'] ?? '';
    return this.tables()[id] ?? this.ctx?.table(id) ?? null;
  });

  // ---- dados de exemplo das prévias (só no editor)
  private readonly visible = computed(() => (this.table()?.fields ?? []).filter((f) => !f.buildersOnly));
  protected readonly formFields = computed(() => this.visible().filter((f) => !f.readOnly).slice(0, 6));
  protected readonly columns = computed(() => this.visible().slice(0, 6).map((f) => ({ key: f.name, label: f.name })));
  protected readonly sampleRows = computed<UiRow[]>(() =>
    [1, 2].map((n) => ({
      id: String(n),
      cells: Object.fromEntries(this.visible().slice(0, 6).map((f) => [f.name, this.sample(f.type, f.options, n)])),
    })),
  );
  protected readonly sampleBars = computed(() => {
    const field = this.table()?.fields.find((f) => f.name === this.component().props['groupBy']);
    const labels = field?.options.length ? field.options.slice(0, 5) : ['Valor A', 'Valor B', 'Valor C'];
    return labels.map((label, i) => ({ label, value: [8, 5, 3, 2, 1][i] }));
  });

  protected sample(type: FieldType, options: string[] = [], n = 1): string {
    switch (type) {
      case 'number': return n === 1 ? '1.200' : '350';
      case 'date': return n === 1 ? '06/11/2026' : '12/11/2026';
      case 'select': return options[n - 1] ?? options[0] ?? '';
      case 'relation': return 'Registro relacionado';
      case 'file': return 'arquivo.pdf';
      default: return n === 1 ? 'Exemplo' : 'Outro exemplo';
    }
  }

  protected click() {
    const wf = this.component().props['workflowId'];
    if (!this.design() && this.ctx && wf) this.ctx.runWorkflow(wf);
  }
}
