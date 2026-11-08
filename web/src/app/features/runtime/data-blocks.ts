import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { Api, ExportFormat, saveBlob } from '../../core/api';
import { canWrite, visibleFields } from '../../core/auth/auth';
import { DataRecord, FieldDef, GroupCount } from '../../core/models';
import { UI, UiRow } from '../../ui/ui';
import { FormBlock } from './form-block';
import { RunContext, debounced, fileParts, useRecordPage, useRelations } from './run-context';

/** Tabela de registros com editar/excluir (conforme permissões) e importação/exportação CSV. */
@Component({
  selector: 'app-table-block',
  imports: [UI, FormBlock],
  template: `
    @if (table(); as t) {
      <ui-card [title]="t.name">
        <div class="table-tools no-print">
          <ui-input type="search" placeholder="Buscar" [(value)]="query" />
          <span class="spacer"></span>
          <span class="muted small">Baixar</span>
          <button uiButton variant="ghost" (click)="download('xlsx')">Excel</button>
          <button uiButton variant="ghost" (click)="download('pdf')">PDF</button>
          <button uiButton variant="ghost" (click)="download('csv')">CSV</button>
          @if (can('create')) {
            <label uiButton>Importar planilha<input type="file" accept=".xlsx,.csv" hidden (change)="importFile($event)" /></label>
          }
        </div>
        @if (editing(); as r) {
          <app-form-block [tableId]="t.id" [record]="r" (done)="editing.set(null)" />
        }
        <ui-table [columns]="columns()" [rows]="rows()" [empty]="search() ? 'Nada encontrado para essa busca.' : 'Nenhum registro.'">
          <ng-template let-id>
            @let r = byId(id);
            @for (f of fileFields(); track f.id) {
              @if (r?.data?.[f.name]; as v) {
                <button uiButton variant="ghost" [title]="f.name" (click)="downloadAttachment(v)">📎</button>
              }
            }
            @if (can('edit')) {
              <button uiButton variant="ghost" (click)="editing.set(r)">Editar</button>
            }
            @if (can('delete')) {
              <button uiButton variant="danger" (click)="remove(id)">{{ confirmDelete() === id ? 'Confirmar?' : 'Excluir' }}</button>
            }
          </ng-template>
        </ui-table>
        @if (result(); as p) {
          @if (p.pages > 1) {
            <div class="pager no-print">
              <span class="muted small">{{ p.total }} registros, página {{ p.page }} de {{ p.pages }}</span>
              <button uiButton variant="ghost" [disabled]="p.page === 1" (click)="page.set(p.page - 1)">Anterior</button>
              <button uiButton variant="ghost" [disabled]="p.page === p.pages" (click)="page.set(p.page + 1)">Próxima</button>
            </div>
          }
        }
      </ui-card>
    }
  `,
})
export class TableBlock {
  readonly tableId = input.required<string>();
  private readonly ctx = inject(RunContext);
  private readonly api = inject(Api);

  protected readonly table = computed(() => this.ctx.table(this.tableId()));
  protected readonly fields = computed(() => {
    const t = this.table();
    return t ? visibleFields(t, this.ctx.canManage()) : [];
  });
  protected readonly fileFields = computed(() => this.fields().filter((f) => f.type === 'file'));
  protected readonly query = signal('');
  /** Busca efetiva (espera a pessoa parar de digitar). */
  protected readonly search = debounced(this.query, 300);
  /** Volta para a página 1 sempre que a busca muda. */
  protected readonly page = linkedSignal({ source: this.search, computation: () => 1 });
  protected readonly result = useRecordPage(() => ({ tableId: this.tableId(), q: this.search(), page: this.page(), size: PAGE_SIZE }));
  protected readonly records = computed(() => this.result()?.items ?? []);
  private readonly relations = useRelations(() => this.fields());
  protected readonly editing = signal<DataRecord | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);

  protected readonly columns = computed(() => this.fields().map((f) => ({ key: f.name, label: f.name })));
  protected readonly rows = computed<UiRow[]>(() =>
    this.records().map((r) => ({
      id: r.id,
      cells: Object.fromEntries(
        this.fields().map((f) => {
          const v = r.data[f.name] ?? '';
          if (f.type === 'relation') return [f.name, this.relations()[f.name]?.get(v) ?? v];
          if (f.type === 'file') return [f.name, v ? fileParts(v).name : ''];
          return [f.name, cellText(f.type, v)];
        }),
      ),
    })),
  );

  protected byId = (id: string) => this.records().find((r) => r.id === id) ?? null;
  protected can = (op: 'create' | 'edit' | 'delete') => {
    const t = this.table();
    return !!t && canWrite(t, op, this.ctx.canManage());
  };

  protected async remove(id: string) {
    if (this.confirmDelete() !== id) return this.confirmDelete.set(id);
    try {
      await this.api.deleteRecord(this.ctx.appId(), this.ctx.env(), this.tableId(), id);
      this.ctx.handle({ navigateTo: null, log: [] }, 'Registro excluído.');
    } catch (e) {
      this.ctx.fail(e);
    }
  }

  protected async download(format: ExportFormat) {
    try {
      saveBlob(await this.api.exportRecords(this.ctx.appId(), this.ctx.env(), this.tableId(), format), `${this.table()?.name}.${format}`);
    } catch (e) {
      this.ctx.fail(e);
    }
  }

  protected async importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const r = await this.api.importRecords(this.ctx.appId(), this.ctx.env(), this.tableId(), file);
      this.ctx.handle({ navigateTo: null, log: r.errors }, `${r.imported} registro(s) importado(s).`);
    } catch (err) {
      this.ctx.fail(err);
    } finally {
      input.value = '';
    }
  }

  protected async downloadAttachment(value: string) {
    const { id, name } = fileParts(value);
    try {
      saveBlob(await this.api.downloadFile(this.ctx.appId(), this.ctx.env(), id), name);
    } catch (e) {
      this.ctx.fail(e);
    }
  }
}

/** Lista de registros em cards (título + subtítulo), paginada no servidor. */
@Component({
  selector: 'app-list-block',
  imports: [UI],
  template: `
    <div class="list-cards">
      @for (r of result()?.items; track r.id) {
        <ui-card [title]="r.data[titleField()] ?? ''">
          <p class="muted">{{ r.data[subtitleField()] }}</p>
        </ui-card>
      } @empty {
        <p class="muted">Nenhum registro.</p>
      }
    </div>
    @if (result(); as p) {
      @if (p.pages > 1) {
        <div class="pager no-print">
          <span class="muted small">Página {{ p.page }} de {{ p.pages }}</span>
          <button uiButton variant="ghost" [disabled]="p.page === 1" (click)="page.set(p.page - 1)">Anterior</button>
          <button uiButton variant="ghost" [disabled]="p.page === p.pages" (click)="page.set(p.page + 1)">Próxima</button>
        </div>
      }
    }
  `,
})
export class ListBlock {
  readonly tableId = input.required<string>();
  readonly titleField = input<string>('');
  readonly subtitleField = input<string>('');
  protected readonly page = signal(1);
  protected readonly result = useRecordPage(() => ({ tableId: this.tableId(), q: '', page: this.page(), size: LIST_PAGE_SIZE }));
}

/** Gráfico de barras: contagem por valor de um campo, agregada no servidor. */
@Component({
  selector: 'app-chart-block',
  imports: [UI],
  template: `
    <ui-card [title]="title()">
      <ui-bar-chart [data]="data()" />
    </ui-card>
  `,
})
export class ChartBlock {
  readonly tableId = input.required<string>();
  readonly groupBy = input<string>('');
  readonly title = input<string>('');
  private readonly ctx = inject(RunContext);
  private readonly api = inject(Api);
  private readonly counts = signal<GroupCount[]>([]);
  protected readonly data = computed(() => toChart(this.counts()));

  constructor() {
    effect(async () => {
      this.ctx.refresh();
      const [tableId, field] = [this.tableId(), this.groupBy()];
      if (!field) return;
      try {
        this.counts.set(await this.api.summary(this.ctx.appId(), this.ctx.env(), tableId, field));
      } catch (e) {
        this.ctx.fail(e);
      }
    });
  }
}

export const PAGE_SIZE = 20;
export const LIST_PAGE_SIZE = 12;

/** Valor gravado (número invariante, data yyyy-MM-dd) no formato brasileiro, como no PDF. Edição continua no valor cru. */
export function cellText(type: FieldDef['type'], value: string): string {
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  if (type === 'number' && value !== '' && !isNaN(Number(value))) return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return value;
}

/** Contagens do servidor → barras (valor vazio vira "(vazio)"). */
export const toChart = (counts: GroupCount[]) => counts.map((c) => ({ label: c.label || '(vazio)', value: c.value }));
