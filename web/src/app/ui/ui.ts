import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, TemplateRef, computed, contentChild, input, model, output, signal, viewChild } from '@angular/core';
import { CompleteMode, Suggestion, applyCompletion, completionAt, filterSuggestions } from './completion';

// ============================================================================================
// DESIGN SYSTEM (camada de troca). Features usam SOMENTE estes componentes + classes de layout
// de styles.css. Para adotar o design system corporativo, reimplemente os templates abaixo com os
// componentes dele mantendo os mesmos selectors/inputs, e substitua ui.css.
// Ver DOCS/TROCA-DE-ADAPTADORES.md.
// ============================================================================================

export type Option = string | { value: string; label: string };

/** Valores de status que viram carimbo automaticamente (tabelas, aprovações). */
export const STAMP_TONES: Record<string, 'ok' | 'bad' | 'wait'> = {
  Aprovado: 'ok', Rejeitado: 'bad', Pendente: 'wait', Fechado: 'ok', Feito: 'ok', Concluído: 'ok', Ganho: 'ok', Perdido: 'bad',
};


@Component({
  selector: 'button[uiButton], a[uiButton], label[uiButton]',
  template: '<ng-content />',
  host: {
    class: 'ui-btn',
    '[class.ui-btn--primary]': "variant() === 'primary'",
    '[class.ui-btn--danger]': "variant() === 'danger'",
    '[class.ui-btn--ghost]': "variant() === 'ghost'",
    '[attr.type]': 'type()',
  },
})
export class UiButton {
  /** default | primary | danger | ghost */
  readonly variant = input<string | null>('default');
  readonly type = input<string>('button');
}

@Component({
  selector: 'ui-input',
  template: `
    <label class="ui-field" [class.ui-field--inline]="inline()">
      @if (label()) {
        <span>{{ label() }}@if (required()) { <b class="ui-req">*</b> }</span>
      }
      @if (type() === 'textarea') {
        <textarea #field rows="3" [value]="value()" [placeholder]="placeholder()" [class.mono]="mono()" (input)="onInput($event)"
          (keydown)="onKey($event)" (click)="refresh()" (blur)="close()" [attr.aria-autocomplete]="suggestions().length ? 'list' : null"></textarea>
      } @else {
        <input #field [type]="type()" [value]="value()" [placeholder]="placeholder()" [class.mono]="mono()" (input)="onInput($event)"
          (keydown)="onKey($event)" (click)="refresh()" (blur)="close()" [attr.aria-autocomplete]="suggestions().length ? 'list' : null" />
      }
      @if (matches().length) {
        <span class="ui-complete" role="listbox">
          @for (m of matches(); track m.value; let i = $index) {
            <span role="option" class="ui-complete__item" [class.active]="i === active()" [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); pick(m)">
              <code>{{ m.value }}</code>@if (m.hint) {<small>{{ m.hint }}</small>}
            </span>
          }
        </span>
      }
    </label>
  `,
})
export class UiInput {
  readonly label = input('');
  /** text | number | date | email | textarea */
  readonly type = input<string | null>('text');
  readonly placeholder = input('');
  readonly required = input(false);
  /** Sem moldura até passar o mouse/focar (ex.: nome do app na barra do editor, como no Figma). */
  readonly inline = input(false);
  /** Fonte monoespaçada (URLs, JSON, caminhos). */
  readonly mono = input(false);
  /** Variáveis para o autocomplete: em 'template' abre ao digitar {{; em 'path' o campo todo é o caminho. */
  readonly suggestions = input<Suggestion[]>([]);
  readonly complete = input<CompleteMode>('template');
  readonly value = model<string>('');

  private readonly field = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('field');
  private readonly query = signal<string | null>(null);
  protected readonly active = signal(0);
  protected readonly matches = computed(() => {
    const q = this.query();
    return q === null || !this.suggestions().length ? [] : filterSuggestions(this.suggestions(), q);
  });

  protected onInput(e: Event) {
    this.value.set((e.target as HTMLInputElement).value);
    this.refresh();
  }

  protected refresh() {
    const el = this.field()?.nativeElement;
    if (!el || !this.suggestions().length) return;
    const at = completionAt(el.value, el.selectionStart ?? el.value.length, this.complete());
    this.query.set(at?.query ?? null);
    this.active.set(0);
  }

  protected close() {
    this.query.set(null);
  }

  protected onKey(e: KeyboardEvent) {
    const list = this.matches();
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.pick(list[this.active()]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  protected pick(s: Suggestion) {
    const el = this.field()?.nativeElement;
    if (!el) return;
    const next = applyCompletion(el.value, el.selectionStart ?? el.value.length, this.complete(), s.value);
    el.value = next.text;
    el.setSelectionRange(next.caret, next.caret);
    this.value.set(next.text);
    this.refresh();
  }
}

@Component({
  selector: 'ui-select',
  template: `
    <label class="ui-field">
      @if (label()) {
        <span>{{ label() }}@if (required()) { <b class="ui-req">*</b> }</span>
      }
      <select (change)="value.set($any($event.target).value)">
        <option value="" [selected]="!value()">{{ placeholder() }}</option>
        @for (o of opts(); track o.value) {
          <option [value]="o.value" [selected]="o.value === value()">{{ o.label }}</option>
        }
      </select>
    </label>
  `,
})
export class UiSelect {
  readonly label = input('');
  readonly options = input<Option[]>([]);
  readonly placeholder = input('—');
  readonly required = input(false);
  readonly value = model<string>('');
  protected readonly opts = computed(() =>
    this.options().map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
  );
}

@Component({
  selector: 'ui-checkbox',
  template: `
    <label class="ui-check">
      <input type="checkbox" [checked]="checked()" (change)="checked.set($any($event.target).checked)" />
      {{ label() }}
    </label>
  `,
})
export class UiCheckbox {
  readonly label = input('');
  readonly checked = model(false);
}

@Component({
  selector: 'ui-card',
  template: `
    <section class="ui-card" [class.ui-card--plain]="plain()">
      @if (title()) {
        <h3 class="ui-card__title">{{ title() }}</h3>
      }
      <ng-content />
    </section>
  `,
})
export class UiCard {
  readonly title = input<string | null>('');
  /** Sem moldura (fundo, borda e espaçamento): o conteúdo fica direto na página. */
  readonly plain = input(false);
}

export interface UiColumn {
  key: string;
  label: string;
}

export interface UiRow {
  id: string;
  cells: Record<string, string>;
}

/** Tabela de dados. Ações por linha via <ng-template let-id>…</ng-template> projetado. */

@Component({
  selector: 'ui-stamp',
  template: `<span [class]="'ui-stamp ui-stamp--' + tone()"><ng-content /></span>`,
})
export class UiStamp {
  /** ok | bad | wait | neutral */
  readonly tone = input<string>('neutral');
}

@Component({
  selector: 'ui-table',
  imports: [NgTemplateOutlet, UiStamp],
  template: `
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead>
          <tr>
            @for (c of columns(); track c.key) {
              <th>{{ c.label }}</th>
            }
            @if (actions()) {
              <th></th>
            }
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              @for (c of columns(); track c.key) {
                <td>
                  @if (tone(r.cells[c.key]); as t) {
                    <ui-stamp [tone]="t">{{ r.cells[c.key] }}</ui-stamp>
                  } @else {
                    <span class="ui-table__text" [attr.title]="r.cells[c.key] || null">{{ r.cells[c.key] }}</span>
                  }
                </td>
              }
              @if (actions(); as tpl) {
                <td class="ui-table__actions">
                  <ng-container *ngTemplateOutlet="tpl; context: { $implicit: r.id }" />
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td class="muted" [attr.colspan]="columns().length + 1">{{ empty() }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class UiTable {
  readonly columns = input<UiColumn[]>([]);
  readonly rows = input<UiRow[]>([]);
  readonly empty = input('Nenhum registro.');
  protected readonly actions = contentChild(TemplateRef);
  protected tone = (v: string | undefined) => (v ? STAMP_TONES[v] : undefined);
}

@Component({
  selector: 'ui-bar-chart',
  template: `
    <div class="ui-chart">
      @for (d of data(); track d.label) {
        <div class="ui-chart__row">
          <span class="ui-chart__label">{{ d.label }}</span>
          <span class="ui-chart__track"><span [class]="'ui-chart__bar ui-chart__bar--' + (tones[d.label] ?? 'none')" [style.width.%]="(d.value / max()) * 100"></span></span>
          <span class="ui-chart__value">{{ d.value }}</span>
        </div>
      } @empty {
        <p class="muted">Sem dados.</p>
      }
    </div>
  `,
})
export class UiBarChart {
  readonly data = input<{ label: string; value: number }[]>([]);
  protected readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));
  protected readonly tones: Partial<Record<string, string>> = STAMP_TONES;
}

@Component({
  selector: 'ui-notice',
  template: `<p class="ui-notice" [class.ui-notice--error]="error()" role="status"><ng-content /></p>`,
})
export class UiNotice {
  readonly error = input(false);
}

/** Escolha única entre poucas opções, todas visíveis (ex.: largura, dispositivo). */
@Component({
  selector: 'ui-segmented',
  template: `
    <div class="ui-segmented" role="radiogroup" [attr.aria-label]="label()" [style.--seg-cols]="columns()">
      @for (o of options(); track o.value) {
        <button type="button" role="radio" [attr.aria-checked]="o.value === value()" [class.active]="o.value === value()"
          [attr.title]="o.title ?? null" (click)="value.set(o.value)">{{ o.label }}</button>
      }
    </div>
  `,
})
export class UiSegmented {
  readonly options = input<{ value: string; label: string; title?: string }[]>([]);
  readonly value = model<string>('');
  readonly label = input('');
  /** 0 = todas numa linha; N = grade com N colunas. */
  readonly columns = input(0);
}

/** Caminhos SVG (viewBox 16×16, traço 1.5). Para trocar a biblioteca de ícones, troque só este mapa. */
const ICONS: Record<string, string> = {
  // navegação
  home: 'M2.5 7 8 2.5 13.5 7v6.5h-11zM6.5 13.5v-4h3v4',
  catalog: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  approvals: 'M2.5 8.5 6 12l7.5-8',
  projects: 'M8 2 14 5 8 8 2 5zM2 8l6 3 6-3M2 11l6 3 6-3',
  admin: 'M8 1.5 13.5 3.5V8c0 3-2.4 5.3-5.5 6.5C4.9 13.3 2.5 11 2.5 8V3.5z',
  plus: 'M8 3v10M3 8h10',
  back: 'M10 3 5 8l5 5',
  sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z',
  auto: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v12',
  external: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v4h-9.5V4h4',
  play: 'M5 3 13 8 5 13z',
  layers: 'M8 2 14 5 8 8 2 5zM2 8l6 3 6-3',
  insert: 'M2.5 2.5h11v11h-11zM8 5.5v5M5.5 8h5',
  // tipos de projeto
  app: 'M2.5 3.5h11v9h-11zM2.5 6h11M6 6v6.5',
  form: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
  workflow: 'M2.5 3.5h4v3h-4zM9.5 9.5h4v3h-4zM6.5 5h3a1.5 1.5 0 0 1 1.5 1.5v3',
  // componentes do editor
  text: 'M3 4h10M8 4v9',
  button: 'M2.5 5.5h11v5h-11z',
  input: 'M2.5 5.5h11v5h-11zM4.5 8h3',
  card: 'M2.5 3.5h11v9h-11zM2.5 6.5h11',
  table: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.5 3.5v9',
  list: 'M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h1M2.5 8h1M2.5 11.5h1',
  chart: 'M3 13V8.5M7 13V4M11 13V9.5M2 13.5h12',
  container: 'M2.5 2.5h11v11h-11zM5 5h6v6H5z',
  // workflows
  click: 'M5.5 2v2M2 5.5h2M3 3l1.3 1.3M6.5 6.5l7 2.5-3 1.5-1.5 3z',
  recordCreated: 'M3 2.5h7l3 3v8H3zM8 7v4M6 9h4',
  recordUpdated: 'M3 2.5h7l3 3v8H3zM5.5 10.5 9.5 6.5l1 1-4 4h-1z',
  schedule: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.5V8l2.5 1.5',
  condition: 'M8 1.5 14.5 8 8 14.5 1.5 8z',
  createRecord: 'M3 2.5h7l3 3v8H3zM8 7v4M6 9h4',
  updateRecord: 'M3 2.5h7l3 3v8H3zM5.5 10.5 9.5 6.5l1 1-4 4h-1z',
  sendEmail: 'M2 3.5h12v9H2zM2 4l6 5 6-5',
  callApi: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
  navigate: 'M3 8h10M9 4l4 4-4 4',
  requestApproval: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5.5 8l2 2 3-4',
  runWorkflow: 'M5 3 13 8 5 13z',
  manual: 'M5 3 13 8 5 13z',
  webhook: 'M5 11a3 3 0 1 1 3-5M11 11a3 3 0 1 1-3-5M8 6l3 5',
  loop: 'M12.5 6A5 5 0 0 0 3.5 5M3.5 10a5 5 0 0 0 9 1M12.5 2.5V6H9M3.5 13.5V10H7',
  wait: 'M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3 6 5.5S5 10.5 5 13.5M11 2.5c0 3-6 3-6 5.5s6 2.5 6 5.5',
  transform: 'M3 5h7M3 11h10M10 3l2 2-2 2M6 9l-2 2 2 2',
  key: 'M10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM7.5 8.5 2.5 13.5M4.5 11.5l1.5 1.5',
};

/** Ícone por nome (ver ICONS). Herda a cor do texto. */
@Component({
  selector: 'ui-icon',
  template: `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true"><path [attr.d]="path()" /></svg>`,
  host: { style: 'display: inline-flex' },
})
export class UiIcon {
  readonly name = input.required<string>();
  protected readonly path = computed(() => ICONS[this.name()] ?? ICONS['container']);
}

// ---------- Respostas de formulário (estilo Typeform: grandes, uma pergunta por tela) ----------

/** Campo de resposta grande, sublinhado. Enter emite `enter` (no texto longo, Shift+Enter quebra a linha). */
@Component({
  selector: 'ui-answer',
  template: `
    <label class="ui-answer">
      <span class="ui-sr">{{ label() }}</span>
      @if (type() === 'textarea') {
        <textarea rows="3" [value]="value()" [placeholder]="placeholder()" [disabled]="disabled()"
          (input)="value.set($any($event.target).value)" (keydown.enter)="onEnter($event)"></textarea>
      } @else {
        <input [type]="type()" [value]="value()" [placeholder]="placeholder()" [disabled]="disabled()"
          (input)="value.set($any($event.target).value)" (keydown.enter)="onEnter($event)" />
      }
    </label>
  `,
})
export class UiAnswer {
  readonly label = input('');
  /** text | email | number | date | textarea */
  readonly type = input('text');
  readonly placeholder = input('');
  readonly disabled = input(false);
  readonly value = model('');
  readonly enter = output<void>();

  protected onEnter(e: Event) {
    if ((e as KeyboardEvent).shiftKey && this.type() === 'textarea') return;
    e.preventDefault();
    this.enter.emit();
  }
}

/** Opções com letra (A, B, C... ou S/N). Escolher marca e emite `picked`. */
@Component({
  selector: 'ui-choices',
  template: `
    <div class="ui-choices" role="radiogroup" [attr.aria-label]="label()">
      @for (o of options(); track o.label) {
        <button type="button" role="radio" class="ui-choice" [class.active]="o.label === value()" [attr.aria-checked]="o.label === value()"
          [disabled]="disabled()" (click)="pick(o.label)">
          <span class="ui-choice__key">{{ o.key }}</span><span class="ui-choice__label">{{ o.label }}</span>
        </button>
      }
    </div>
  `,
})
export class UiChoices {
  readonly label = input('');
  readonly options = input<{ key: string; label: string }[]>([]);
  readonly disabled = input(false);
  readonly value = model('');
  readonly picked = output<string>();

  protected pick(label: string) {
    this.value.set(label);
    this.picked.emit(label);
  }
}

/** Escala numérica (ex.: 0 a 10) com rótulos nas pontas. */
@Component({
  selector: 'ui-scale',
  template: `
    <div class="ui-scale" role="radiogroup" [attr.aria-label]="label()">
      <div class="ui-scale__row" [style.--n]="values().length">
        @for (n of values(); track n) {
          <button type="button" role="radio" class="ui-choice ui-scale__item" [class.active]="'' + n === value()" [attr.aria-checked]="'' + n === value()"
            [disabled]="disabled()" (click)="pick('' + n)">{{ n }}</button>
        }
      </div>
      <div class="ui-scale__ends"><span>{{ low() }}</span><span>{{ high() }}</span></div>
    </div>
  `,
})
export class UiScale {
  readonly label = input('');
  readonly values = input<number[]>([]);
  readonly low = input('');
  readonly high = input('');
  readonly disabled = input(false);
  readonly value = model('');
  readonly picked = output<string>();

  protected pick(v: string) {
    this.value.set(v);
    this.picked.emit(v);
  }
}

/** Importe `UI` em `imports` dos componentes de feature. */
export const UI = [
  UiButton, UiInput, UiSelect, UiCheckbox, UiCard, UiTable, UiBarChart, UiNotice, UiStamp, UiSegmented, UiIcon, UiAnswer, UiChoices, UiScale,
] as const;
