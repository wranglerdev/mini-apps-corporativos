import { Component, input, linkedSignal, output } from '@angular/core';
import { VariableDef, VariableType } from '../../core/models';
import { Suggestion } from '../../ui/completion';
import { UI } from '../../ui/ui';
import { VARIABLE_TYPES } from './variable-ops';

/** Editor de uma variável (painel da direita): nome, tipo, padrão e apelido. Quem usa valida e grava. */
@Component({
  selector: 'app-var-editor',
  imports: [UI],
  host: { style: 'display: contents' },
  template: `
    @let v = variable();
    <div class="panel__section"><div class="panel__title">Variável <code class="mono">{{ open }}{{ v.name }}{{ close }}</code></div></div>
    <div class="panel__section">
      <ui-input label="Nome" [mono]="true" [value]="nameDraft()" (valueChange)="setName($event)" />
      <ui-select label="Tipo" [options]="typeOptions" [value]="v.type" placeholder="—" (valueChange)="change.emit({ key: 'type', value: $event || 'text' })" />
      <ui-input label="Padrão (quando vazia)" [mono]="true" [placeholder]="'Vazio = ' + emptyOf(v.type)" [value]="v.default ?? ''"
        (valueChange)="change.emit({ key: 'default', value: $event })" />
      <ui-input label="Apelido de (caminho)" [mono]="true" [placeholder]="pathPlaceholder()" complete="path" [suggestions]="paths()"
        [value]="v.from ?? ''" (valueChange)="setFrom($event)" />
      @if (nameError() ?? problem(); as e) { <p class="runner__problem small">{{ e }}</p> }
      <p class="panel__hint">
        @if (v.from) {
          Acompanha {{ v.from }} e só aparece nos passos depois dele. Antes disso, vale o padrão.
        } @else {
          Existe desde o início com o padrão. Grave nela com o passo Transformar.
        }
      </p>
    </div>
    <div class="panel__section row">
      <span class="spacer"></span>
      <button uiButton variant="danger" (click)="remove.emit()">Remover</button>
    </div>
  `,
})
export class VarEditor {
  readonly variable = input.required<VariableDef>();
  /** Problema atual da variável (validação de quem usa). */
  readonly problem = input<string | null>(null);
  /** Valida um nome antes de renomear (null = ok). */
  readonly problemFor = input.required<(name: string) => string | null>();
  readonly paths = input<Suggestion[]>([]);
  readonly pathPlaceholder = input('steps.api1.body');
  readonly rename = output<string>();
  readonly change = output<{ key: 'type' | 'default' | 'from'; value: string }>();
  readonly remove = output<void>();

  protected readonly open = '{{';
  protected readonly close = '}}';
  protected readonly typeOptions = Object.entries(VARIABLE_TYPES).map(([value, t]) => ({ value, label: t.label }));
  /** Nome em edição (pode estar inválido); volta ao nome ao trocar de variável. */
  protected readonly nameDraft = linkedSignal(() => this.variable().name);
  protected readonly nameError = linkedSignal<string | null>(() => (this.variable(), null));

  protected emptyOf = (type: VariableType) => VARIABLE_TYPES[type]?.empty ?? '';

  protected setName(value: string) {
    this.nameDraft.set(value);
    const problem = this.problemFor()(value);
    this.nameError.set(problem);
    if (!problem && value !== this.variable().name) this.rename.emit(value);
  }

  /** Arrastar uma variável para o apelido traz {{ }}: o apelido é só o caminho. */
  protected setFrom(value: string) {
    this.change.emit({ key: 'from', value: value.replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, '') });
  }
}
