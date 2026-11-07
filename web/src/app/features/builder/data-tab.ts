import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { Api } from '../../core/api';
import { AppDefinition, FieldDef, FieldType, TableDef, TablePermissions } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { addTable, generatePageForTable, newField, removeTable } from './editor-ops';

/** Banco embutido: tabelas, campos (tipos, obrigatório, só builders, opções, relação) e permissões. */
@Component({
  selector: 'app-data-tab',
  imports: [UI, LAYOUT],
  template: `
    @let d = def();
    <div class="two-cols">
      <aside class="panel">
        @for (t of d.tables; track t.id) {
          <div class="list-item" [class.active]="t.id === table()?.id" (click)="tableId.set(t.id)">{{ t.name }}</div>
        } @empty {
          <p class="muted small">Nenhuma tabela ainda.</p>
        }
        <div style="margin-top: 16px">
          <ui-input label="Nova tabela" placeholder="Ex.: Solicitações" [(value)]="newName" />
          <button uiButton (click)="createTable()" [disabled]="!newName()">Criar tabela</button>
        </div>
      </aside>

      @if (table(); as t) {
        <section class="stack stack--sections">
          <app-section title="Tabela e permissões" description="Quem usa o app sempre pode ver os registros. Quem gerencia o app pode tudo.">
            <button actions uiButton variant="danger" (click)="deleteTable()">Excluir tabela</button>
            <ui-input label="Nome" [value]="t.name" (valueChange)="renameTable($event)" />
            <div class="row">
              <ui-checkbox label="Usuário pode criar" [checked]="t.permissions.userCanCreate" (checkedChange)="setPerm('userCanCreate', $event)" />
              <ui-checkbox label="Usuário pode editar" [checked]="t.permissions.userCanEdit" (checkedChange)="setPerm('userCanEdit', $event)" />
              <ui-checkbox label="Usuário pode excluir" [checked]="t.permissions.userCanDelete" (checkedChange)="setPerm('userCanDelete', $event)" />
            </div>
            <div class="row" style="margin-top: 8px">
              <button uiButton variant="primary" (click)="generate()">Gerar página com formulário e lista</button>
            </div>
          </app-section>

          <app-section title="Receber dados de outros sistemas" description="Webhook: um ERP, planilha ou outro sistema cria registros nesta tabela por HTTP.">
            @if (t.webhookKey) {
              <div class="webhook">
                <span><strong>POST</strong> {{ webhookUrl(t.id) }}</span>
                <span><strong>Header</strong> X-Webhook-Key: {{ t.webhookKey }}</span>
                <span><strong>Corpo</strong> JSON com os nomes dos campos, ex.: {{ example(t) }}</span>
              </div>
              <div class="row">
                <button uiButton (click)="setWebhook(true)">Gerar nova chave</button>
                <button uiButton variant="danger" (click)="setWebhook(false)">Desligar</button>
              </div>
            } @else {
              <p class="muted small" style="margin-bottom: 10px">
                Desligado. Ligue para que um ERP, planilha ou outro sistema crie registros nesta tabela por HTTP.
              </p>
              <button uiButton (click)="setWebhook(true)">Ligar webhook</button>
            }
            <p class="muted small" style="margin-top: 10px">Vale para a versão publicada: publique depois de ligar ou trocar a chave.</p>
          </app-section>

          <app-section title="Campos" description="Só leitura: o usuário vê mas não edita. Oculto: só quem gerencia o app vê.">
            @for (f of t.fields; track f.id; let i = $index) {
              <div class="field-row">
                <ui-input label="Nome" [value]="f.name" (valueChange)="setField(i, 'name', $event)" />
                <ui-select label="Tipo" [options]="types" [value]="f.type" (valueChange)="setType(i, $event)" />
                @if (f.type !== 'select' && f.type !== 'relation') {
                  <span></span>
                }
                @if (f.type === 'select') {
                  <ui-input label="Opções (separadas por vírgula)" [value]="f.options.join(', ')" (valueChange)="setOptions(i, $event)" />
                }
                @if (f.type === 'relation') {
                  <ui-select label="Tabela relacionada" [options]="tableOptions()" [value]="f.relationTableId ?? ''"
                    (valueChange)="setField(i, 'relationTableId', $event)" />
                }
                <div class="field-row__flags">
                  <ui-checkbox label="Obrigatório" [checked]="f.required" (checkedChange)="setField(i, 'required', $event)" />
                  <ui-checkbox label="Só leitura" [checked]="f.readOnly" (checkedChange)="setField(i, 'readOnly', $event)" />
                  <ui-checkbox label="Oculto" [checked]="f.buildersOnly" (checkedChange)="setField(i, 'buildersOnly', $event)" />
                  <button uiButton variant="danger" (click)="removeField(i)">Remover</button>
                </div>
              </div>
            }
            <button uiButton style="margin-top: 14px" (click)="addField()">Adicionar campo</button>
          </app-section>
        </section>
      }
    </div>
  `,
})
export class DataTab {
  readonly def = model.required<AppDefinition>();
  readonly appId = input.required<string>();
  private readonly api = inject(Api);
  /** Emite o id da página gerada para o editor abrir a aba de design. */
  readonly pageGenerated = output<string>();

  protected readonly types: { value: FieldType; label: string }[] = [
    { value: 'text', label: 'Texto' }, { value: 'number', label: 'Número' }, { value: 'date', label: 'Data' },
    { value: 'select', label: 'Seleção' }, { value: 'relation', label: 'Relação' }, { value: 'file', label: 'Arquivo' },
  ];
  protected readonly tableId = signal<string | null>(null);
  protected readonly newName = signal('');
  protected readonly table = computed<TableDef | null>(() => {
    const tables = this.def().tables;
    return tables.find((t) => t.id === this.tableId()) ?? tables[0] ?? null;
  });
  protected readonly tableOptions = computed(() => this.def().tables.map((t) => ({ value: t.id, label: t.name })));

  private edit(fn: (d: AppDefinition) => void) {
    const d = structuredClone(this.def());
    fn(d);
    this.def.set(d);
  }

  protected editTable(fn: (t: TableDef) => void) {
    this.edit((d) => fn(d.tables.find((t) => t.id === this.table()!.id)!));
  }

  protected webhookUrl = (tableId: string) => this.api.webhookUrl(this.appId(), tableId);
  protected example = (t: TableDef) => JSON.stringify(Object.fromEntries(t.fields.slice(0, 2).map((f) => [f.name, '...'])));

  protected setWebhook(on: boolean) {
    this.editTable((t) => (t.webhookKey = on ? crypto.randomUUID().replaceAll('-', '') : null));
  }

  protected renameTable(name: string) {
    this.editTable((t) => (t.name = name));
  }

  protected createTable() {
    this.edit((d) => this.tableId.set(addTable(d, this.newName().trim()).id));
    this.newName.set('');
  }

  protected deleteTable() {
    this.edit((d) => removeTable(d, this.table()!.id));
    this.tableId.set(null);
  }

  protected generate() {
    let pageId = '';
    this.edit((d) => (pageId = generatePageForTable(d, this.table()!.id).id));
    this.pageGenerated.emit(pageId);
  }

  protected setPerm(key: keyof TablePermissions, value: boolean) {
    this.editTable((t) => (t.permissions[key] = value));
  }

  protected setField<K extends keyof FieldDef>(i: number, key: K, value: FieldDef[K]) {
    this.editTable((t) => (t.fields[i][key] = value));
  }

  protected setType(i: number, type: string) {
    this.editTable((t) => {
      const f = t.fields[i];
      f.type = type as FieldType;
      if (f.type === 'select' && f.options.length === 0) f.options = ['Opção 1'];
    });
  }

  protected setOptions(i: number, text: string) {
    this.editTable((t) => (t.fields[i].options = text.split(',').map((o) => o.trim()).filter(Boolean)));
  }

  protected addField() {
    this.editTable((t) => t.fields.push(newField(`Campo ${t.fields.length + 1}`)));
  }

  protected removeField(i: number) {
    this.editTable((t) => t.fields.splice(i, 1));
  }
}
