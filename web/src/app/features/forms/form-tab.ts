import { Component, computed, model, signal } from '@angular/core';
import { AppDefinition, ConditionOp, FieldDef, JumpDef, QuestionDef, QuestionKind } from '../../core/models';
import { UI } from '../../ui/ui';
import { CONDITION_OPS } from '../runtime/visibility';
import { PALETTE_KINDS, QUESTION_KINDS, choicesOf } from './form-flow';
import { addJump, addQuestion, fieldOf, formOf, formTable, jumpTargets, moveQuestion, removeJump, removeQuestion, setKind } from './form-ops';
import { QuestionView } from './question-view';

type Selection = 'welcome' | 'end' | string;

/**
 * Aba Perguntas do formulário (moldura do editor, prévia estilo Typeform): lista à esquerda (boas-vindas, perguntas,
 * tela final) + paleta de tipos; prévia no centro; propriedades e lógica de pulo à direita.
 */
@Component({
  selector: 'app-form-tab',
  imports: [UI, QuestionView],
  template: `
    @let f = form();
    <div class="editor">
      <aside class="panel panel--left" aria-label="Perguntas">
        <div class="panel__section">
          <div class="panel__head">
            <h4>Perguntas</h4>
            <span class="muted small">{{ f.questions.length }}</span>
          </div>
          <button type="button" class="tree-item" [class.active]="selected() === 'welcome'" (click)="selected.set('welcome')">
            <span class="q-badge q-badge--soft">◐</span><span class="tree-item__text">Boas-vindas</span>
          </button>
          @for (q of f.questions; track q.id; let i = $index) {
            <button type="button" class="tree-item" [class.active]="selected() === q.id" (click)="selected.set(q.id)">
              <span class="q-badge">{{ i + 1 }}</span>
              <span class="tree-item__text">{{ q.title || 'Sem título' }}</span>
              @if (q.jumps.length) { <span class="tree-item__flag" title="Tem lógica de pulo">pula</span> }
              @if (fieldOfQ(q)?.required) { <span class="q-req" aria-label="obrigatória">*</span> }
            </button>
          }
          <button type="button" class="tree-item" [class.active]="selected() === 'end'" (click)="selected.set('end')">
            <span class="q-badge q-badge--soft">✓</span><span class="tree-item__text">Tela final</span>
          </button>
        </div>
        <div class="panel__section panel__section--grow">
          <h4>Adicionar pergunta</h4>
          <p class="panel__hint">Entra depois da pergunta selecionada.</p>
          @for (k of palette; track k) {
            <button type="button" class="palette-item" (click)="add(k)">
              <span class="palette-item__icon"><ui-icon [name]="kinds[k].icon" /></span><span>{{ kinds[k].label }}</span>
            </button>
          }
        </div>
      </aside>

      <section class="canvas" aria-label="Prévia">
        <div class="canvas__bar">
          <ui-segmented label="Dispositivo" [options]="devices" [(value)]="device" />
        </div>
        <div class="frame" [class.frame--mobile]="device() === 'mobile'">
          <span class="frame__label">{{ frameLabel() }}</span>
          <div class="sheet form-stage">
            <div class="form-stage__progress"><span [style.width.%]="progress()"></span></div>
            @switch (selected()) {
              @case ('welcome') {
                <div class="runner__screen">
                  <h1 class="runner__title">{{ f.welcomeTitle || 'Título de boas-vindas' }}</h1>
                  @if (f.welcomeText) { <p class="runner__text">{{ f.welcomeText }}</p> }
                  <div class="row"><button uiButton variant="primary" class="runner__go" disabled>Começar</button></div>
                </div>
              }
              @case ('end') {
                <div class="runner__screen">
                  <span class="runner__check" aria-hidden="true"><ui-icon name="approvals" /></span>
                  <h1 class="runner__title">{{ f.endTitle || 'Resposta enviada' }}</h1>
                  @if (f.endText) { <p class="runner__text">{{ f.endText }}</p> }
                </div>
              }
              @default {
                @if (question(); as q) {
                  <div class="runner__screen">
                    <app-question-view [question]="q" [field]="field()" [number]="index() + 1" [design]="true" />
                    <div class="row runner__actions"><button uiButton variant="primary" class="runner__go" disabled>OK</button></div>
                  </div>
                }
              }
            }
          </div>
        </div>
      </section>

      <aside class="panel panel--right" aria-label="Propriedades">
        @switch (selected()) {
          @case ('welcome') {
            <div class="panel__section"><div class="panel__title">Boas-vindas</div></div>
            <div class="panel__section">
              <ui-input label="Título" placeholder="Usa o nome do formulário se vazio" [value]="f.welcomeTitle" (valueChange)="setForm('welcomeTitle', $event)" />
              <ui-input label="Texto" type="textarea" placeholder="Para que serve, quanto tempo leva, como os dados são usados (LGPD)"
                [value]="f.welcomeText" (valueChange)="setForm('welcomeText', $event)" />
            </div>
          }
          @case ('end') {
            <div class="panel__section"><div class="panel__title">Tela final</div></div>
            <div class="panel__section">
              <ui-input label="Título" [value]="f.endTitle" (valueChange)="setForm('endTitle', $event)" />
              <ui-input label="Texto" type="textarea" [value]="f.endText" (valueChange)="setForm('endText', $event)" />
              <ui-input label="Redirecionar para (opcional)" placeholder="https://intranet.corp.local/rh" [value]="f.redirectUrl ?? ''"
                (valueChange)="setForm('redirectUrl', $event)" />
              <p class="panel__hint">Só endereços http(s). Leva o respondente depois de alguns segundos.</p>
            </div>
          }
          @default {
            @if (question(); as q) {
              <div class="panel__section">
                <div class="panel__title"><ui-icon [name]="kinds[q.kind].icon" /> Pergunta {{ index() + 1 }} · {{ kinds[q.kind].label }}</div>
              </div>
              <div class="panel__section">
                <ui-input label="Pergunta" type="textarea" [value]="q.title" (valueChange)="setQuestion('title', $event)" />
                <ui-input label="Descrição (opcional)" placeholder="Ajuda abaixo da pergunta" [value]="q.description" (valueChange)="setQuestion('description', $event)" />
                <ui-select label="Tipo" [options]="kindOptions" [value]="q.kind" placeholder="—" (valueChange)="changeKind($event)" />
                <ui-checkbox label="Obrigatória" [checked]="!!field()?.required" (checkedChange)="setField('required', $event)" />
                <ui-input label="Coluna na tabela Respostas" [value]="field()?.name ?? ''" (valueChange)="setField('name', $event)" />
              </div>

              @if (q.kind === 'choice') {
                <div class="panel__section">
                  <h4>Opções</h4>
                  @for (o of field()?.options ?? []; track $index; let i = $index) {
                    <div class="option-row">
                      <span class="q-badge q-badge--soft">{{ letter(i) }}</span>
                      <ui-input [label]="'Opção ' + letter(i)" [value]="o" (valueChange)="setOption(i, $event)" />
                      <button uiButton variant="ghost" class="icon-btn" [attr.aria-label]="'Remover opção ' + letter(i)" [disabled]="(field()?.options?.length ?? 0) < 2" (click)="removeOption(i)">×</button>
                    </div>
                  }
                  <button uiButton variant="ghost" (click)="addOption()"><ui-icon name="plus" /> Adicionar opção</button>
                </div>
              }

              <div class="panel__section">
                <h4>Lógica</h4>
                @for (j of q.jumps; track $index; let i = $index) {
                  <div class="jump">
                    <span class="panel__hint">Se a resposta</span>
                    <ui-select label="Condição" [options]="ops" [value]="j.op" placeholder="—" (valueChange)="setJump(i, 'op', $event)" />
                    @if (j.op !== 'empty' && j.op !== 'notEmpty') {
                      @if (answerOptions().length) {
                        <ui-select label="Valor" [options]="answerOptions()" [value]="j.value ?? ''" (valueChange)="setJump(i, 'value', $event)" />
                      } @else {
                        <ui-input label="Valor" [value]="j.value ?? ''" (valueChange)="setJump(i, 'value', $event)" />
                      }
                    }
                    <ui-select label="Ir para" [options]="targets()" [value]="j.goTo" placeholder="—" (valueChange)="setJump(i, 'goTo', $event)" />
                    <button uiButton variant="danger" (click)="dropJump(i)">Remover regra</button>
                  </div>
                } @empty {
                  <p class="panel__hint">Sem regra: segue para a próxima pergunta.</p>
                }
                @if (targets().length) {
                  <button uiButton variant="ghost" (click)="newJump()"><ui-icon name="plus" /> Adicionar regra</button>
                }
                <p class="panel__hint">A primeira regra que bater vence. Pulos só vão para perguntas seguintes; obrigatórias fora do caminho não são exigidas.</p>
              </div>

              <div class="panel__section row">
                <button uiButton variant="ghost" [disabled]="index() === 0" (click)="move(-1)">↑ Subir</button>
                <button uiButton variant="ghost" [disabled]="index() === f.questions.length - 1" (click)="move(1)">↓ Descer</button>
                <span class="spacer"></span>
                <button uiButton variant="danger" [disabled]="f.questions.length < 2" (click)="remove()">Remover</button>
              </div>
            }
          }
        }
      </aside>
    </div>
  `,
})
export class FormTab {
  readonly def = model.required<AppDefinition>();

  protected readonly kinds = QUESTION_KINDS;
  protected readonly palette = PALETTE_KINDS;
  protected readonly kindOptions = PALETTE_KINDS.map((k) => ({ value: k, label: QUESTION_KINDS[k].label }));
  protected readonly ops = CONDITION_OPS;
  protected readonly devices = [{ value: 'desktop', label: 'Computador' }, { value: 'mobile', label: 'Celular' }];
  protected readonly device = signal('desktop');
  protected readonly selected = signal<Selection>('welcome');

  protected readonly form = computed(() => formOf(this.def()));
  protected readonly index = computed(() => this.form().questions.findIndex((q) => q.id === this.selected()));
  protected readonly question = computed<QuestionDef | null>(() => this.form().questions[this.index()] ?? null);
  protected readonly field = computed(() => {
    const q = this.question();
    return q ? fieldOf(this.def(), q) : undefined;
  });
  protected readonly targets = computed(() => (this.question() ? jumpTargets(this.form(), this.question()!.id) : []));
  protected readonly answerOptions = computed(() => {
    const q = this.question();
    return q ? choicesOf(q, this.field()).map((c) => c.label) : [];
  });
  protected readonly progress = computed(() => {
    const n = this.form().questions.length;
    return this.selected() === 'welcome' ? 0 : this.selected() === 'end' ? 100 : Math.round((this.index() / Math.max(1, n)) * 100);
  });
  protected readonly frameLabel = computed(() =>
    this.selected() === 'welcome' ? 'Boas-vindas' : this.selected() === 'end' ? 'Tela final' : `Pergunta ${this.index() + 1} de ${this.form().questions.length}`);

  protected fieldOfQ = (q: QuestionDef): FieldDef | undefined => fieldOf(this.def(), q);
  protected letter = (i: number) => String.fromCharCode(65 + i);

  /** Toda alteração passa por aqui: clona, muta e emite a nova definição. */
  private edit(fn: (d: AppDefinition) => void) {
    const d = structuredClone(this.def());
    fn(d);
    this.def.set(d);
  }

  private q = (d: AppDefinition) => formOf(d).questions.find((x) => x.id === this.selected())!;

  protected add(kind: QuestionKind) {
    let id = '';
    const at = this.index() >= 0 ? this.index() + 1 : this.selected() === 'welcome' ? 0 : undefined;
    this.edit((d) => (id = addQuestion(d, kind, at).id));
    this.selected.set(id);
  }

  protected remove() {
    const i = this.index();
    this.edit((d) => removeQuestion(d, this.selected()));
    const list = this.form().questions;
    this.selected.set(list[Math.min(i, list.length - 1)]?.id ?? 'welcome');
  }

  protected move(delta: -1 | 1) {
    this.edit((d) => moveQuestion(d, this.selected(), delta));
  }

  protected changeKind(kind: string) {
    if (kind) this.edit((d) => setKind(d, this.selected(), kind as QuestionKind));
  }

  protected setForm(key: 'welcomeTitle' | 'welcomeText' | 'endTitle' | 'endText' | 'redirectUrl', value: string) {
    this.edit((d) => {
      const f = formOf(d);
      if (key === 'redirectUrl') f.redirectUrl = value.trim() || null;
      else f[key] = value;
    });
  }

  protected setQuestion(key: 'title' | 'description', value: string) {
    this.edit((d) => (this.q(d)[key] = value));
  }

  protected setField(key: 'required' | 'name', value: boolean | string) {
    this.edit((d) => {
      const field = formTable(d).fields.find((f) => f.id === this.q(d).fieldId);
      if (field) (field as unknown as Record<string, unknown>)[key] = value;
    });
  }

  protected setOption(i: number, value: string) {
    this.edit((d) => (formTable(d).fields.find((f) => f.id === this.q(d).fieldId)!.options[i] = value));
  }

  protected addOption() {
    this.edit((d) => {
      const field = formTable(d).fields.find((f) => f.id === this.q(d).fieldId)!;
      field.options.push(`Opção ${field.options.length + 1}`);
    });
  }

  protected removeOption(i: number) {
    this.edit((d) => formTable(d).fields.find((f) => f.id === this.q(d).fieldId)!.options.splice(i, 1));
  }

  protected newJump() {
    this.edit((d) => addJump(d, this.selected()));
  }

  protected dropJump(i: number) {
    this.edit((d) => removeJump(d, this.selected(), i));
  }

  protected setJump(i: number, key: keyof JumpDef, value: string) {
    this.edit((d) => {
      const jump = this.q(d).jumps[i];
      if (key === 'op') jump.op = value as ConditionOp;
      else if (key === 'value') jump.value = value;
      else jump.goTo = value;
    });
  }
}
