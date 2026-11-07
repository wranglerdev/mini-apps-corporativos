import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { AppDefinition, Env, RunDetail, RunStep, WorkflowRun } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { RUN_STATUS, duration, isDone, waterfall } from './flow-ops';

const POLL_MS = 1500;

const TRIGGER_LABEL: Record<string, string> = { manual: 'Manual', schedule: 'Agendado', webhook: 'Webhook' };

/**
 * Aba Execuções: lista (produção ou testes do rascunho) e, ao abrir uma, a linha do tempo em waterfall (referência:
 * trigger.dev) com entrada/saída de cada trecho e reexecução do início ou de um passo. Atualiza sozinha enquanto há
 * execução na fila ou rodando.
 */
@Component({
  selector: 'app-runs-tab',
  imports: [UI, LAYOUT],
  template: `
    @if (detail(); as d) {
      <div class="stack stack--sections">
        <div class="row">
          <button uiButton variant="ghost" (click)="close()"><ui-icon name="back" /> Execuções</button>
          <strong class="mono">#{{ d.run.number }}</strong>
          <ui-stamp [tone]="tone(d.run.status)">{{ label(d.run.status) }}</ui-stamp>
          @if (retried()) { <span class="chip chip--warn">passo repetido</span> }
          <span class="spacer"></span>
          @if (selectedTop(); as top) {
            <button uiButton [disabled]="!isDone(d.run.status)" (click)="rerun(top)">Reexecutar a partir de “{{ top }}”</button>
          }
          <button uiButton variant="primary" [disabled]="!isDone(d.run.status)" (click)="rerun(null)">Reexecutar do início</button>
        </div>
        <p class="muted small">
          {{ triggerLabel(d.run.trigger) }} · {{ when(d.run.createdAt) }} · {{ total() }}
          @if (d.run.version) { · v{{ d.run.version }} } · {{ d.steps.length }} trechos
        </p>
        @if (d.run.error) { <ui-notice [error]="true">{{ d.run.error }}</ui-notice> }

        <div class="run-view">
          <div class="waterfall" role="list" aria-label="Linha do tempo">
            @for (r of rows(); track r.step.id) {
              <button type="button" role="listitem" class="waterfall__row" [class.active]="r.step.id === spanId()" (click)="spanId.set(r.step.id)">
                <span class="waterfall__name" [style.padding-left.px]="10 + r.step.depth * 16">
                  <span class="waterfall__dot" [attr.data-tone]="tone(r.step.status)" [attr.data-type]="r.step.type"></span>
                  <span class="waterfall__label">{{ r.step.name }}</span>
                </span>
                <span class="waterfall__track">
                  <span class="waterfall__bar" [attr.data-tone]="tone(r.step.status)" [attr.data-type]="r.step.type" [style.left.%]="r.leftPct" [style.width.%]="r.widthPct"></span>
                </span>
                <span class="waterfall__time">{{ r.durationText }}</span>
              </button>
            }
          </div>
          <aside class="run-span">
            @if (span(); as s) {
              <div class="row"><span class="waterfall__dot" [attr.data-tone]="tone(s.status)"></span><strong>{{ s.name }}</strong></div>
              <p class="muted small">{{ label(s.status) }} · começou em {{ spanRow()?.startText }} · durou {{ spanRow()?.durationText }}</p>
              @if (s.error) { <ui-notice [error]="s.status === 'failed'">{{ s.error }}</ui-notice> }
              <h4>Entrada</h4>
              <pre class="json">{{ pretty(s.input) }}</pre>
              <h4>Saída</h4>
              <pre class="json">{{ pretty(s.output) }}</pre>
              <p class="muted small">Até 16 KB por trecho, por 30 dias. Segredos aparecem como ••••.</p>
            } @else {
              <p class="muted small">Clique num trecho da linha do tempo para ver entrada e saída.</p>
            }
          </aside>
        </div>
      </div>
    } @else {
      <app-section [title]="env() === 'prod' ? 'Execuções' : 'Testes do rascunho'" description="Cada disparo vira uma execução, com o histórico de cada passo por 30 dias.">
        <div actions class="row">
          <ui-segmented label="Ambiente" [options]="envs" [value]="env()" (valueChange)="env.set($any($event))" />
          @if (env() === 'prod') {
            <button uiButton variant="primary" [disabled]="!published()" (click)="runNow()"><ui-icon name="play" /> Executar agora</button>
          }
        </div>
        @if (notice(); as n) { <ui-notice [error]="n.error">{{ n.text }}</ui-notice> }
        @if (env() === 'prod' && !published()) {
          <app-empty title="Ainda não publicado" text="Publique para que o gatilho comece a disparar. Para testar, use Testar na aba Workflow." />
        } @else {
          <div class="index">
            @for (r of runs(); track r.id) {
              <button type="button" class="index__row run-row" (click)="open(r)">
                <div>
                  <span class="index__name mono">#{{ r.number }}</span>
                  <div class="index__meta">
                    <ui-stamp [tone]="tone(r.status)">{{ label(r.status) }}</ui-stamp>
                    <span class="chip">{{ triggerLabel(r.trigger) }}</span>
                    @if (r.startFromStepId) { <span class="chip">a partir de {{ r.startFromStepId }}</span> }
                    <span class="muted small">{{ when(r.createdAt) }} · {{ runDuration(r) }}</span>
                  </div>
                  @if (r.error) { <p class="muted small run-row__error">{{ r.error }}</p> }
                </div>
                <ui-icon name="navigate" />
              </button>
            } @empty {
              <app-empty title="Nenhuma execução ainda" [text]="env() === 'prod' ? 'Use Executar agora ou espere o gatilho.' : 'Use Testar na aba Workflow.'" />
            }
          </div>
        }
      </app-section>
    }
  `,
})
export class RunsTab {
  readonly appId = input.required<string>();
  readonly published = input<AppDefinition | null>(null);
  private readonly api = inject(Api);

  protected readonly envs = [{ value: 'prod', label: 'Produção' }, { value: 'draft', label: 'Testes' }];
  protected readonly env = signal<Env>('prod');
  protected readonly runs = signal<WorkflowRun[]>([]);
  protected readonly detail = signal<RunDetail | null>(null);
  protected readonly spanId = signal<string | null>(null);
  protected readonly notice = signal<Notice>(null);
  protected readonly isDone = isDone;

  private readonly view = computed(() => waterfall(this.detail()?.steps ?? []));
  protected readonly rows = computed(() => this.view().rows);
  protected readonly total = computed(() => duration(this.view().totalMs));
  protected readonly span = computed<RunStep | null>(() => this.detail()?.steps.find((s) => s.id === this.spanId()) ?? null);
  protected readonly spanRow = computed(() => this.rows().find((r) => r.step.id === this.spanId()));
  protected readonly retried = computed(() => (this.detail()?.steps ?? []).some((s) => s.type === 'backoff'));
  /** Passo de 1º nível do trecho selecionado: dá para reexecutar a partir dele. */
  protected readonly selectedTop = computed(() => {
    const steps = this.detail()?.steps ?? [];
    let s = this.span();
    while (s?.parentId) s = steps.find((x) => x.id === s!.parentId) ?? null;
    return s?.depth === 0 ? s.stepId : null;
  });

  constructor() {
    effect(() => {
      this.env();
      this.appId();
      untracked(() => this.reload());
    });
    const timer = setInterval(() => this.poll(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected label = (s: string) => RUN_STATUS[s]?.label ?? s;
  protected tone = (s: string) => RUN_STATUS[s]?.tone ?? 'neutral';
  protected triggerLabel = (t: string) => TRIGGER_LABEL[t] ?? t;
  protected when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  protected runDuration(r: WorkflowRun) {
    if (!r.startedAt) return 'na fila';
    return r.finishedAt ? duration(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : 'rodando…';
  }
  protected pretty(text: string | null) {
    if (!text) return '—';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  protected async open(r: WorkflowRun) {
    await this.attempt(async () => {
      const d = await this.api.runDetail(this.appId(), r.env, r.id);
      this.detail.set(d);
      this.spanId.set(d.steps.find((s) => s.status === 'failed')?.id ?? d.steps[0]?.id ?? null);
    });
  }

  protected close() {
    this.detail.set(null);
    this.reload();
  }

  protected runNow() {
    return this.attempt(async () => {
      const run = await this.api.runNow(this.appId(), 'prod');
      this.notice.set({ text: `Execução #${run.number} na fila.`, error: false });
      await this.reload();
    });
  }

  protected rerun(fromStepId: string | null) {
    const d = this.detail();
    if (!d) return;
    return this.attempt(async () => {
      const run = await this.api.rerun(this.appId(), d.run.env, d.run.id, fromStepId);
      await this.open(run);
    });
  }

  private async reload() {
    await this.attempt(async () => {
      if (this.env() === 'prod' && !this.published()) return this.runs.set([]);
      this.runs.set(await this.api.runs(this.appId(), this.env()));
    });
  }

  /** Enquanto algo está na fila ou rodando, atualiza a lista ou a execução aberta. */
  private async poll() {
    const d = this.detail();
    if (d && !isDone(d.run.status)) {
      const fresh = await this.api.runDetail(this.appId(), d.run.env, d.run.id).catch(() => null);
      if (fresh && this.detail()?.run.id === fresh.run.id) this.detail.set(fresh);
    } else if (!d && this.runs().some((r) => !isDone(r.status))) {
      await this.reload();
    }
  }

  private async attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    }
  }
}
