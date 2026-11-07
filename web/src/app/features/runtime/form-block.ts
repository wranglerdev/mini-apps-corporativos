import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Api } from '../../core/api';
import { writableFields } from '../../core/auth/auth';
import { DataRecord, FieldType, Props } from '../../core/models';
import { UI } from '../../ui/ui';
import { RunContext, fileParts, useRelations } from './run-context';

/** Formulário gerado a partir da tabela: um campo por coluna visível. Cria ou edita (quando `record`). */
@Component({
  selector: 'app-form-block',
  imports: [UI],
  template: `
    @if (table(); as t) {
      <ui-card [title]="record() ? 'Editar registro' : title() || 'Novo em ' + t.name">
        <form (submit)="$event.preventDefault(); save()">
          @for (f of fields(); track f.id) {
            @switch (f.type) {
              @case ('select') {
                <ui-select [label]="f.name" [required]="f.required" [options]="f.options"
                  [value]="values()[f.name] ?? ''" (valueChange)="set(f.name, $event)" />
              }
              @case ('relation') {
                <ui-select [label]="f.name" [required]="f.required" [options]="relationOptions()[f.name] ?? []"
                  [value]="values()[f.name] ?? ''" (valueChange)="set(f.name, $event)" />
              }
              @case ('file') {
                <label class="ui-field">
                  <span>{{ f.name }}</span>
                  <input type="file" (change)="upload(f.name, $event)" />
                  @if (values()[f.name]; as v) {
                    <small class="muted">{{ fileName(v) }}</small>
                  }
                </label>
              }
              @default {
                <ui-input [label]="f.name" [type]="inputType(f.type)" [required]="f.required"
                  [value]="values()[f.name] ?? ''" (valueChange)="set(f.name, $event)" />
              }
            }
          }
          <div class="row">
            <button uiButton variant="primary" type="submit" [disabled]="busy()">{{ submitLabel() || 'Salvar' }}</button>
            @if (record()) {
              <button uiButton (click)="done.emit()">Cancelar</button>
            }
          </div>
        </form>
      </ui-card>
    }
  `,
})
export class FormBlock {
  readonly tableId = input.required<string>();
  readonly title = input<string | null>(null);
  readonly submitLabel = input<string | null>(null);
  readonly record = input<DataRecord | null>(null);
  readonly done = output<void>();

  private readonly ctx = inject(RunContext);
  private readonly api = inject(Api);

  protected readonly table = computed(() => this.ctx.table(this.tableId()));
  protected readonly fields = computed(() => {
    const t = this.table();
    return t ? writableFields(t, this.ctx.canManage()) : [];
  });
  protected readonly values = linkedSignal<Props>(() => ({ ...(this.record()?.data ?? {}) }));
  protected readonly busy = signal(false);
  private readonly relations = useRelations(() => this.fields());
  protected readonly relationOptions = computed<Partial<Record<string, { value: string; label: string }[]>>>(() =>
    Object.fromEntries(
      Object.entries(this.relations()).map(([k, m]) => [k, [...m].map(([value, label]) => ({ value, label }))]),
    ),
  );

  protected set(field: string, value: string) {
    this.values.update((v) => ({ ...v, [field]: value }));
  }

  protected inputType(t: FieldType) {
    return t === 'number' ? 'number' : t === 'date' ? 'date' : 'text';
  }

  protected fileName = (v: string) => fileParts(v).name;

  protected async upload(field: string, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const stored = await this.api.uploadFile(this.ctx.appId(), this.ctx.env(), file);
      this.set(field, `${stored.id}/${stored.name}`);
    } catch (err) {
      this.ctx.fail(err);
    }
  }

  async save() {
    this.busy.set(true);
    try {
      const { appId, env } = { appId: this.ctx.appId(), env: this.ctx.env() };
      const rec = this.record();
      const result = rec
        ? await this.api.updateRecord(appId, env, this.tableId(), rec.id, this.values())
        : await this.api.createRecord(appId, env, this.tableId(), this.values());
      this.ctx.handle(result.workflow, 'Registro salvo.');
      this.values.set({});
      this.done.emit();
    } catch (e) {
      this.ctx.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}
