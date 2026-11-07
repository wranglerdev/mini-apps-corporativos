import { Component, computed, input, model } from '@angular/core';
import { AppDefinition } from '../../core/models';
import { Option, UI } from '../../ui/ui';
import { PropSpec } from './editor-ops';

/** Controle genérico do painel de propriedades/parametros, guiado por PropSpec. */
@Component({
  selector: 'app-prop-control',
  imports: [UI],
  template: `
    @let s = spec();
    @if (s.kind === 'text' || s.kind === 'textarea') {
      <ui-input [label]="s.label" [type]="s.kind === 'textarea' ? 'textarea' : 'text'" [(value)]="value" />
    } @else {
      <ui-select [label]="s.label" [options]="options()" [(value)]="value" />
    }
  `,
})
export class PropControl {
  readonly spec = input.required<PropSpec>();
  readonly def = input.required<AppDefinition>();
  /** Tabela usada para listar campos (kind = field). */
  readonly tableId = input<string | null>(null);
  readonly value = model<string>('');

  protected readonly options = computed<Option[]>(() => {
    const d = this.def();
    switch (this.spec().kind) {
      case 'table':
        return d.tables.map((t) => ({ value: t.id, label: t.name }));
      case 'workflow':
        return d.workflows.filter((w) => w.trigger.type === 'click').map((w) => ({ value: w.id, label: w.name }));
      case 'anyWorkflow':
        return d.workflows.map((w) => ({ value: w.id, label: w.name }));
      case 'page':
        return d.pages.map((p) => ({ value: p.id, label: p.name }));
      case 'field':
        return d.tables.find((t) => t.id === this.tableId())?.fields.map((f) => f.name) ?? [];
      default:
        return this.spec().options ?? [];
    }
  });
}
