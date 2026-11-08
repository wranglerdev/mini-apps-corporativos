import { Component, computed, input, output } from '@angular/core';
import { ConditionDef, ConditionJoin, ConditionRule } from '../../core/models';
import { Option, UI } from '../../ui/ui';
import { Suggestion } from '../../ui/completion';
import { CONDITION_OPS } from '../runtime/visibility';
import { JOIN_OPTIONS, addRule, removeRule, rulesOf, setJoin, setRule } from './condition-ops';

/** Editor de condição com várias regras (E/OU). Emite a condição nova; quem usa decide se a vazia vira null. */
@Component({
  selector: 'app-condition-editor',
  imports: [UI],
  template: `
    @let all = rules();
    @if (all.length > 1) {
      <ui-segmented label="Juntar regras" [options]="joins" [value]="join()" (valueChange)="changeJoin($event)" />
    }
    @for (r of all; track $index; let i = $index) {
      <div class="condition-rule">
        @if (all.length > 1) {
          <div class="condition-rule__head">
            <span>{{ i === 0 ? 'Regra 1' : join() === 'or' ? 'ou' : 'e' }}</span>
            <button uiButton variant="ghost" [attr.aria-label]="'Remover regra ' + (i + 1)" (click)="remove(i)">Remover</button>
          </div>
        }
        @if (fields(); as opts) {
          <ui-select [label]="i === 0 ? fieldLabel() : 'Campo / variável'" [placeholder]="fieldPlaceholder() || '—'" [options]="opts"
            [value]="r.field" (valueChange)="set(i, 'field', $event)" />
        } @else {
          <ui-input [label]="i === 0 ? fieldLabel() : 'Campo / variável'" [placeholder]="fieldPlaceholder()" [value]="r.field"
            [suggestions]="suggestions()" complete="path" [mono]="!!suggestions().length" (valueChange)="set(i, 'field', $event)" />
        }
        @if (r.field) {
          <ui-select label="Operador" [options]="ops" [value]="r.op" (valueChange)="set(i, 'op', $event)" />
          @if (r.op !== 'empty' && r.op !== 'notEmpty') {
            <ui-input [label]="valueLabel()" [value]="r.value ?? ''" [suggestions]="suggestions()" (valueChange)="set(i, 'value', $event)" />
          }
        }
      </div>
    }
    @if (canAdd()) {
      <button uiButton variant="ghost" (click)="add()">+ Regra</button>
    }
  `,
})
export class ConditionEditor {
  readonly condition = input<ConditionDef | null>(null);
  /** Lista de campos/variáveis; sem lista, o campo é digitado. */
  readonly fields = input<Option[] | null>(null);
  readonly fieldLabel = input('Campo / variável');
  readonly fieldPlaceholder = input('');
  readonly valueLabel = input('Valor');
  /** Variáveis para o autocomplete (workflows): campo como caminho, valor com {{. */
  readonly suggestions = input<Suggestion[]>([]);
  readonly changed = output<ConditionDef>();

  protected readonly ops = CONDITION_OPS;
  protected readonly joins = JOIN_OPTIONS;
  protected readonly rules = computed(() => rulesOf(this.condition()));
  protected readonly join = computed<ConditionJoin>(() => (this.condition()?.join === 'or' ? 'or' : 'and'));
  protected readonly canAdd = computed(() => this.rules().every((r) => r.field.trim()));

  protected set(i: number, key: keyof ConditionRule, value: string) {
    this.changed.emit(setRule(this.condition(), i, key, value));
  }
  protected add() {
    this.changed.emit(addRule(this.condition()));
  }
  protected remove(i: number) {
    this.changed.emit(removeRule(this.condition(), i));
  }
  protected changeJoin(join: string) {
    this.changed.emit(setJoin(this.condition(), join === 'or' ? 'or' : 'and'));
  }
}
