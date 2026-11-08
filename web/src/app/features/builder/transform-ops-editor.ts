import { Component, computed, input, output } from '@angular/core';
import { TransformOp, VariableDef } from '../../core/models';
import { Suggestion } from '../../ui/completion';
import { UI } from '../../ui/ui';
import { TRANSFORM_OPS } from './variable-ops';

/** Operações do passo Transformar (workflows e automações): cada uma lê uma entrada e grava numa variável. */
@Component({
  selector: 'app-transform-ops-editor',
  imports: [UI],
  host: { style: 'display: contents' },
  template: `
    @for (o of ops(); track $index; let i = $index) {
      <div class="transform-op">
        <div class="option-row">
          <ui-select label="Gravar em" [options]="targets()" [value]="o.target" placeholder="Variável…" (valueChange)="set(i, 'target', $event)" />
          <button uiButton variant="ghost" class="icon-btn" [attr.aria-label]="'Remover operação ' + (i + 1)" (click)="remove(i)">×</button>
        </div>
        <ui-select label="Operação" [options]="opOptions" [value]="o.op" placeholder="—" (valueChange)="set(i, 'op', $event || 'set')" />
        <ui-input label="Entrada" [mono]="true" [placeholder]="inputPlaceholder()" [value]="o.input ?? ''" [suggestions]="suggestions()"
          (valueChange)="set(i, 'input', $event)" />
        @if (spec(o).arg; as arg) {
          <ui-input [label]="arg" [mono]="true" [placeholder]="spec(o).argPlaceholder ?? ''" [value]="o.arg ?? ''" [suggestions]="suggestions()"
            (valueChange)="set(i, 'arg', $event)" />
        }
      </div>
    } @empty {
      <p class="panel__hint">Cada operação lê uma entrada ({{ open }}variáveis{{ close }} ou texto) e grava o resultado numa variável, convertendo para o tipo dela.</p>
    }
    @if (targets().length) {
      <button uiButton variant="ghost" (click)="add()"><ui-icon name="plus" /> Adicionar operação</button>
    } @else {
      <button uiButton (click)="createVariable.emit()"><ui-icon name="plus" /> Criar variável para gravar</button>
    }
  `,
})
export class TransformOpsEditor {
  readonly ops = input.required<TransformOp[]>();
  readonly variables = input.required<VariableDef[]>();
  readonly suggestions = input<Suggestion[]>([]);
  readonly inputPlaceholder = input('{{steps.api1.body}}');
  readonly opsChange = output<TransformOp[]>();
  readonly createVariable = output<void>();

  protected readonly open = '{{';
  protected readonly close = '}}';
  protected readonly opOptions = Object.entries(TRANSFORM_OPS).map(([value, o]) => ({ value, label: `${o.group}: ${o.label}` }));
  /** Destinos: variáveis que não são apelido (o apelido acompanha a origem). */
  protected readonly targets = computed(() => this.variables().filter((v) => !v.from && v.name).map((v) => ({ value: v.name, label: v.name })));

  protected spec = (o: TransformOp) => TRANSFORM_OPS[o.op] ?? TRANSFORM_OPS['set'];

  protected add() {
    this.opsChange.emit([...this.ops(), { target: this.targets()[0]?.value ?? '', op: 'set', input: '', arg: null }]);
  }

  protected set(i: number, key: keyof TransformOp, value: string) {
    this.opsChange.emit(this.ops().map((o, j) => {
      if (j !== i) return o;
      const next = { ...o, [key]: value };
      if (key === 'op' && !TRANSFORM_OPS[value]?.arg) next.arg = null;
      return next;
    }));
  }

  protected remove(i: number) {
    this.opsChange.emit(this.ops().filter((_, j) => j !== i));
  }
}
