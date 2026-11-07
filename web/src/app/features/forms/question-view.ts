import { Component, computed, input, model, output } from '@angular/core';
import { FieldDef, QuestionDef } from '../../core/models';
import { UI } from '../../ui/ui';
import { SCALE, choicesOf } from './form-flow';

const PLACEHOLDER: Partial<Record<QuestionDef['kind'], string>> = {
  short: 'Digite sua resposta aqui…', long: 'Escreva aqui… (Shift + Enter quebra a linha)', email: 'nome@empresa.com', number: 'Digite um número',
};
const INPUT_TYPE: Partial<Record<QuestionDef['kind'], string>> = { long: 'textarea', email: 'email', number: 'number', date: 'date' };

/** Uma pergunta (estilo Typeform): número, enunciado, descrição e a forma de responder. Usada no respondente e na prévia do editor. */
@Component({
  selector: 'app-question-view',
  imports: [UI],
  template: `
    @let q = question();
    <div class="question">
      <span class="question__n" aria-hidden="true">{{ number() }}<ui-icon name="navigate" /></span>
      <div class="question__body">
        <h1 class="question__title">{{ q.title || 'Escreva a pergunta' }}@if (field()?.required) {<span class="question__req" aria-label="obrigatória"> *</span>}</h1>
        @if (q.description) {
          <p class="question__desc">{{ q.description }}</p>
        }
        <div class="question__answer">
          @switch (q.kind) {
            @case ('choice') {
              <ui-choices [label]="q.title" [options]="choices()" [disabled]="design()" [(value)]="value" (picked)="picked.emit($event)" />
            }
            @case ('yesno') {
              <ui-choices [label]="q.title" [options]="choices()" [disabled]="design()" [(value)]="value" (picked)="picked.emit($event)" />
            }
            @case ('scale') {
              <ui-scale [label]="q.title" [values]="scale" low="0 — nada provável" high="10 — com certeza" [disabled]="design()"
                [(value)]="value" (picked)="picked.emit($event)" />
            }
            @default {
              <ui-answer [label]="q.title" [type]="inputType()" [placeholder]="placeholder()" [disabled]="design()" [(value)]="value" (enter)="enter.emit()" />
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class QuestionView {
  readonly question = input.required<QuestionDef>();
  readonly field = input<FieldDef | undefined>(undefined);
  readonly number = input(1);
  /** Prévia do editor: mostra, mas não responde. */
  readonly design = input(false);
  readonly value = model('');
  readonly enter = output<void>();
  readonly picked = output<string>();

  protected readonly scale = SCALE;
  protected readonly choices = computed(() => choicesOf(this.question(), this.field()));
  protected readonly inputType = computed(() => INPUT_TYPE[this.question().kind] ?? 'text');
  protected readonly placeholder = computed(() => PLACEHOLDER[this.question().kind] ?? '');
}
