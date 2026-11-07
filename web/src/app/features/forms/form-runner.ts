import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { PRODUCT_NAME } from '../../app';
import { Api, errorMessage } from '../../core/api';
import { FormSubmitResult, FormView, Props } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { answerProblem, nextIndex, progressAt } from './form-flow';
import { QuestionView } from './question-view';

const OPEN = 'open';
const REDIRECT_MS = 4000;

/**
 * Respondente (referência: Typeform): boas-vindas, uma pergunta por tela com lógica de pulo, envio e tela final.
 * `/f/:slug` responde a versão publicada; `/f-preview/:id` testa o rascunho (só quem gerencia, grava nos dados de teste).
 */
@Component({
  selector: 'app-form-runner',
  imports: [UI, LAYOUT, QuestionView],
  host: { class: 'runner' },
  template: `
    <div class="runner__progress" role="progressbar" aria-label="Progresso" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="progress()">
      <span [style.width.%]="progress()"></span>
    </div>

    <app-page width="stage" [notice]="notice()">
      @if (view(); as v) {
        @if (done(); as d) {
          <section class="runner__screen">
            <span class="runner__check" aria-hidden="true"><ui-icon name="approvals" /></span>
            <h1 class="runner__title">{{ d.endTitle || 'Resposta enviada' }}</h1>
            @if (d.endText) { <p class="runner__text">{{ d.endText }}</p> }
            @if (redirect()) { <p class="muted small">Você será levado para outra página em instantes. <a [href]="redirect()">Ir agora</a></p> }
            @if (preview()) { <button uiButton (click)="restart()">Responder de novo</button> }
          </section>
        } @else if (step() < 0) {
          <section class="runner__screen">
            <h1 class="runner__title">{{ v.form.welcomeTitle || v.name }}</h1>
            @if (v.form.welcomeText) { <p class="runner__text">{{ v.form.welcomeText }}</p> }
            <div class="row">
              <button uiButton variant="primary" class="runner__go" (click)="start()">Começar</button>
              <span class="muted small">{{ v.form.questions.length }} {{ v.form.questions.length === 1 ? 'pergunta' : 'perguntas' }}</span>
            </div>
          </section>
        } @else if (question(); as q) {
          <section class="runner__screen">
            <app-question-view [question]="q" [field]="field()" [number]="step() + 1" [value]="value()" (valueChange)="setValue($event)"
              (enter)="next()" (picked)="pick($event)" />
            @if (problem(); as p) { <p class="runner__problem" role="alert">{{ p }}</p> }
            <div class="row runner__actions">
              <button uiButton variant="primary" class="runner__go" [disabled]="sending()" (click)="next()">{{ last() ? 'Enviar' : 'OK' }}</button>
              <span class="muted small">pressione <strong>Enter ↵</strong></span>
            </div>
          </section>
        }
      } @else if (loadError(); as e) {
        <app-empty title="Não foi possível abrir o formulário" [text]="e" />
      }
    </app-page>

    <footer class="runner__nav">
      <span class="muted small">Feito com {{ productName }}</span>
      @if (view() && !done() && step() >= 0) {
        <button uiButton variant="primary" class="icon-btn" aria-label="Pergunta anterior" [disabled]="!history().length" (click)="back()">
          <ui-icon name="back" />
        </button>
      }
    </footer>
  `,
})
export class FormRunner {
  /** /f/:slug */
  readonly slug = input<string>();
  /** /f-preview/:id */
  readonly id = input<string>();
  private readonly api = inject(Api);

  protected readonly productName = PRODUCT_NAME;
  protected readonly view = signal<FormView | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly step = signal(-1);
  protected readonly history = signal<number[]>([]);
  protected readonly answers = signal<Props>({});
  protected readonly problem = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly done = signal<FormSubmitResult | null>(null);
  protected readonly notice = signal<Notice>(null);
  private readonly reached = new Set<string>();

  protected readonly preview = computed(() => !!this.id());
  protected readonly question = computed(() => this.view()?.form.questions[this.step()] ?? null);
  protected readonly field = computed(() => this.view()?.fields.find((f) => f.id === this.question()?.fieldId));
  protected readonly value = computed(() => this.answers()[this.field()?.name ?? ''] ?? '');
  protected readonly last = computed(() => {
    const v = this.view();
    return !!v && this.step() >= 0 && nextIndex(v.form, v.fields, this.step(), this.answers()) < 0;
  });
  protected readonly progress = computed(() => {
    const v = this.view();
    return !v ? 0 : this.done() ? 100 : progressAt(v.form, this.step());
  });
  protected readonly redirect = computed(() => {
    const url = this.done()?.redirectUrl ?? '';
    return /^https?:\/\//i.test(url) ? url : null; // só http(s)
  });

  constructor() {
    effect(() => {
      const [slug, id] = [this.slug(), this.id()];
      untracked(() => this.load(slug, id));
    });
  }

  protected start() {
    this.go(0, false);
  }

  protected setValue(v: string) {
    const name = this.field()?.name;
    if (!name) return;
    this.answers.update((a) => ({ ...a, [name]: v }));
    this.problem.set(null);
  }

  /** Escolha (opção/escala) avança sozinha, como no Typeform. */
  protected pick(v: string) {
    this.setValue(v);
    setTimeout(() => this.next(), 250);
  }

  protected next() {
    const v = this.view();
    const q = this.question();
    if (!v || !q || this.sending()) return;
    const problem = answerProblem(q, this.field(), this.value());
    if (problem) return this.problem.set(problem);
    const i = nextIndex(v.form, v.fields, this.step(), this.answers());
    if (i < 0) return this.submit();
    this.go(i, true);
  }

  protected back() {
    const h = this.history();
    if (!h.length) return;
    this.step.set(h[h.length - 1]);
    this.history.set(h.slice(0, -1));
    this.problem.set(null);
  }

  protected restart() {
    this.done.set(null);
    this.answers.set({});
    this.history.set([]);
    this.step.set(-1);
  }

  private go(index: number, remember: boolean) {
    if (remember) this.history.update((h) => [...h, this.step()]);
    this.step.set(index);
    this.problem.set(null);
    const q = this.view()?.form.questions[index];
    if (q) this.track(`q:${q.id}`);
  }

  private async submit() {
    this.sending.set(true);
    try {
      const answers = this.answers();
      const result = this.preview() ? await this.api.submitFormDraft(this.id()!, answers) : await this.api.submitForm(this.slug()!, answers);
      this.done.set(result);
      const url = this.redirect();
      if (url && !this.preview()) setTimeout(() => (location.href = url), REDIRECT_MS);
    } catch (e) {
      this.problem.set(errorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }

  private async load(slug: string | undefined, id: string | undefined) {
    try {
      const v = id ? await this.api.formDraft(id) : await this.api.form(slug!);
      this.view.set(v);
      if (id) this.notice.set({ text: 'Teste do rascunho: as respostas vão para os dados de teste, não para a produção.', error: false });
      this.track(OPEN);
    } catch (e) {
      this.loadError.set(errorMessage(e));
    }
  }

  /** Conta "abriu" e "chegou à pergunta" uma vez por visita, só na versão publicada. Falha não atrapalha quem responde. */
  private track(key: string) {
    if (this.preview() || this.reached.has(key)) return;
    this.reached.add(key);
    this.api.formEvent(this.slug()!, key).catch(() => undefined);
  }
}
