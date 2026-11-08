import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, input, linkedSignal, model, signal } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { ActionDef, AppDefinition, ConditionDef, Frequency, RunDetail, TransformOp, VariableType, WorkflowDef } from '../../core/models';
import { UI } from '../../ui/ui';
import { WEEKDAYS } from '../builder/editor-ops';
import { ConditionEditor } from '../builder/condition-editor';
import { TransformOpsEditor } from '../builder/transform-ops-editor';
import { VarEditor } from '../builder/var-editor';
import { VarPanel } from '../builder/var-panel';
import { VARIABLE_TYPES, VarItem, addVariable, inputsProblem, removeVariable, renameInput, renameVariable, variableProblem } from '../builder/variable-ops';
import {
  PALETTE, RUN_STATUS, STEPS, StepType, flowOf, flowTriggerSummary, idProblem, insertNear, isDone, locate, loopNames, moveStep, removeStep, renameStep,
  resultsByStep, stepSummary, testValue, variablesAt,
} from './flow-ops';

const TEST_POLL_MS = 700;
const TEST_MAX_POLLS = 120;

/**
 * Aba Workflow (referência: n8n): passos em coluna, com "se" e "para cada" como blocos aninhados; paleta e variáveis à
 * esquerda; parâmetros, tentativas e saída do teste à direita. "Testar" salva, roda o rascunho na fila e mostra o
 * resultado em cada passo.
 */
@Component({
  selector: 'app-flow-tab',
  imports: [UI, NgTemplateOutlet, ConditionEditor, VarPanel, VarEditor, TransformOpsEditor],
  template: `
    @let wf = flow();
    <div class="editor">
      <aside class="panel panel--left" aria-label="Passos disponíveis">
        @for (g of palette; track g.label) {
          <div class="panel__section">
            <h4>{{ g.label }}</h4>
            @for (t of g.types; track t) {
              <button type="button" class="palette-item" (click)="add(t)">
                <span class="palette-item__icon"><ui-icon [name]="steps[t].icon" /></span><span>{{ steps[t].label }}</span>
              </button>
            }
          </div>
        }
        <app-var-panel [variables]="variables()" [items]="vars()" [selected]="selectedVar()" [lastValue]="lastValue"
          (select)="selected.set('var:' + $event)" (create)="newVariable()" />
      </aside>

      <section class="canvas canvas--dots" aria-label="Passos do workflow">
        <div class="canvas__bar">
          <button uiButton variant="primary" [disabled]="testing()" (click)="test()"><ui-icon name="play" /> {{ testing() ? 'Testando…' : 'Testar no rascunho' }}</button>
          @if (testText(); as t) { <span class="muted small" style="padding-right: 8px">{{ t }}</span> }
        </div>

        <div class="flow flow--tree">
          <button type="button" class="node node--trigger" [class.selected]="selected() === 'trigger'" (click)="selected.set('trigger')">
            <span class="node__icon"><ui-icon [name]="triggerIcon()" /></span>
            <span class="node__body">
              <span class="node__kind">Gatilho</span>
              <strong class="node__title">{{ triggerLabels[wf.trigger.type] || wf.trigger.type }}</strong>
              <span class="node__summary">{{ triggerText() }}</span>
            </span>
          </button>
          <ng-container *ngTemplateOutlet="tree; context: { $implicit: wf.actions, parentId: null, branch: 'steps' }" />
        </div>
      </section>

      <aside class="panel panel--right" aria-label="Parâmetros">
        @if (selected() === 'trigger') {
          <div class="panel__section"><div class="panel__title"><ui-icon [name]="triggerIcon()" /> Gatilho</div></div>
          <div class="panel__section">
            <ui-select label="Quando" [options]="triggerOptions" [value]="wf.trigger.type" placeholder="—" (valueChange)="setTriggerType($event)" />
            @switch (wf.trigger.type) {
              @case ('manual') { <p class="panel__hint">Roda pelo botão "Executar agora" da aba Execuções (produção) ou por "Testar" (rascunho).</p> }
              @case ('call') {
                <p class="panel__hint">Um mini app ou formulário do workspace inicia este workflow com a ação "Iniciar workflow" e manda as entradas abaixo, que chegam como {{ open }}input.nome{{ close }} já no tipo.</p>
                @for (inp of wf.trigger.inputs ?? []; track $index; let i = $index) {
                  <div class="transform-op">
                    <div class="option-row">
                      <ui-input label="Entrada" [mono]="true" [value]="inp.name" (valueChange)="setInput(i, 'name', $event)" />
                      <button uiButton variant="ghost" class="icon-btn" [attr.aria-label]="'Remover entrada ' + inp.name" (click)="removeInput(i)">×</button>
                    </div>
                    <div class="form-row">
                      <ui-select label="Tipo" [options]="typeOptions" [value]="inp.type" placeholder="—" (valueChange)="setInput(i, 'type', $event || 'text')" />
                      <ui-input label="Padrão" [mono]="true" [value]="inp.default ?? ''" (valueChange)="setInput(i, 'default', $event)" />
                    </div>
                  </div>
                } @empty {
                  <p class="panel__hint">Sem entradas: o workflow roda só com {{ open }}trigger.source{{ close }} e {{ open }}trigger.user{{ close }}.</p>
                }
                @if (inputsError(); as e) { <p class="runner__problem small">{{ e }}</p> }
                <button uiButton variant="ghost" (click)="addInput()"><ui-icon name="plus" /> Adicionar entrada</button>
                <p class="panel__hint">"Testar" roda sem entradas (cada uma vale o padrão).</p>
              }
              @case ('schedule') {
                <ui-select label="Frequência" [options]="frequencies" [value]="wf.trigger.frequency ?? ''" (valueChange)="setTrigger('frequency', $event)" />
                @if (wf.trigger.frequency === 'cron') {
                  <ui-input label="Expressão cron" placeholder="0 8 * * 1-5" [value]="wf.trigger.cron ?? ''" (valueChange)="setTrigger('cron', $event)" />
                  <p class="panel__hint">minuto hora dia mês dia-da-semana. Ex.: "0 8 * * 1-5" = dias úteis às 08:00; "*/15 * * * *" = a cada 15 min.</p>
                }
                @if (wf.trigger.frequency === 'weekly') {
                  <ui-select label="Dia" [options]="weekdays" [value]="wf.trigger.dayOfWeek == null ? '' : '' + wf.trigger.dayOfWeek" (valueChange)="setTrigger('dayOfWeek', $event)" />
                }
                @if (wf.trigger.frequency === 'daily' || wf.trigger.frequency === 'weekly') {
                  <ui-input label="Horário" type="time" [value]="wf.trigger.time ?? ''" (valueChange)="setTrigger('time', $event)" />
                }
                <p class="panel__hint">{{ triggerText() }}. Roda na versão publicada, uma execução por vez, no horário do servidor.</p>
              }
              @case ('webhook') {
                <p class="panel__hint">Sistemas externos disparam com POST (corpo JSON, que vira {{ bodyVar }}). Vale para a versão publicada.</p>
                <div class="webhook"><code>{{ webhookUrl() }}</code>@if (wf.trigger.webhookKey) {<code>X-Webhook-Key: {{ wf.trigger.webhookKey }}</code>}</div>
                <button uiButton (click)="newKey()"><ui-icon name="key" /> {{ wf.trigger.webhookKey ? 'Trocar chave' : 'Gerar chave' }}</button>
                <button uiButton variant="ghost" (click)="saveToVariable('entrada', 'trigger.body')"><ui-icon name="plus" /> Guardar corpo em variável</button>
              }
            }
          </div>
        } @else if (variable(); as v) {
          <app-var-editor [variable]="v" [problem]="varProblem()" [problemFor]="nameProblem" [paths]="paths()"
            (rename)="renameVar(v.name, $event)" (change)="setVar(v.name, $event.key, $event.value)" (remove)="deleteVariable(v.name)" />
        } @else if (step(); as s) {
          <div class="panel__section">
            <div class="panel__title"><ui-icon [name]="specOf(s).icon" /> {{ specOf(s).label }}</div>
            @if (result(s); as r) { <p class="panel__hint">Teste: {{ r.text }}</p> }
          </div>
          <div class="panel__section">
            <ui-input label="Id do passo (saída em steps.id)" [value]="idDraft()" (valueChange)="setId($event)" />
            @if (idError(); as e) { <p class="runner__problem small">{{ e }}</p> }
            @for (p of specOf(s).params; track p.key) {
              @if (p.options) {
                <ui-select [label]="p.label" [options]="p.options" [value]="s.params[p.key] ?? ''" (valueChange)="setParam(p.key, $event)" />
              } @else {
                <ui-input [label]="p.label" [type]="p.textarea ? 'textarea' : 'text'" [placeholder]="p.placeholder ?? ''" [value]="s.params[p.key] ?? ''"
                  [mono]="!!p.mono" [suggestions]="vars()" (valueChange)="setParam(p.key, $event)" />
              }
            }
            @if (s.type === 'callApi') {
              <button uiButton variant="ghost" (click)="saveToVariable(s.id + '_resposta', 'steps.' + s.id + '.body')"><ui-icon name="plus" /> Guardar resposta em variável</button>
            }
            @if (s.type === 'if') {
              <app-condition-editor [condition]="s.condition ?? null" fieldLabel="Valor (variável)" fieldPlaceholder="steps.api1.body.total"
                valueLabel="Comparar com" [suggestions]="vars()" (changed)="setCondition($event)" />
              <p class="panel__hint">"Então" roda se a condição for verdadeira; "Senão", se for falsa.</p>
            }
            @if (s.type === 'transform') {
              <app-transform-ops-editor [ops]="s.ops ?? []" [variables]="variables()" [suggestions]="vars()" (opsChange)="setOps($event)"
                (createVariable)="newVariable()" />
              @for (kv of entries(s); track kv.key; let i = $index) {
                <div class="option-row">
                  <ui-input [label]="'Campo ' + (i + 1)" [value]="kv.key" (valueChange)="renameValue(kv.key, $event)" />
                  <ui-input label="Valor" [value]="kv.value" [suggestions]="vars()" (valueChange)="setValue(kv.key, $event)" />
                  <button uiButton variant="ghost" class="icon-btn" [attr.aria-label]="'Remover ' + kv.key" (click)="removeValue(kv.key)">×</button>
                </div>
              }
              @if (entries(s).length) {
                <button uiButton variant="ghost" (click)="addValue()"><ui-icon name="plus" /> Adicionar campo</button>
                <p class="panel__hint">Campos (formato antigo): os próximos passos leem steps.{{ s.id }}.campo.</p>
              }
            }
          </div>
          @if (specOf(s).action) {
            <div class="panel__section">
              <h4>Se falhar</h4>
              <div class="form-row">
                <ui-select label="Tentativas extras" [options]="retryOptions" [value]="'' + (s.retries ?? 0)" placeholder="—" (valueChange)="setRetries($event)" />
                <ui-input label="Tempo limite (s)" type="number" placeholder="30" [value]="s.timeoutSeconds ? '' + s.timeoutSeconds : ''" (valueChange)="setTimeout($event)" />
              </div>
              <p class="panel__hint">Espera crescente entre tentativas (1 s, 2 s, 4 s…). Esgotadas, a execução para e quem gerencia recebe e-mail. Só repita o que não duplica nada no destino.</p>
            </div>
          }
          @if (output(s); as o) {
            <div class="panel__section">
              <h4>Saída do teste</h4>
              <pre class="json">{{ o }}</pre>
            </div>
          }
          <div class="panel__section row">
            <button uiButton variant="ghost" (click)="move(-1)">↑ Subir</button>
            <button uiButton variant="ghost" (click)="move(1)">↓ Descer</button>
            <span class="spacer"></span>
            <button uiButton variant="danger" (click)="remove()">Remover</button>
          </div>
        }
      </aside>
    </div>

    <!-- Lista de passos (raiz, "então", "senão" e "para cada" usam o mesmo template) -->
    <ng-template #tree let-list let-parentId="parentId" let-branch="branch">
      @for (s of list; track s.id) {
        <span class="flow__link" aria-hidden="true"></span>
        <div class="flow-item">
          <button type="button" class="node" [class.node--condition]="specOf(s).container" [class.selected]="selected() === s.id" (click)="selected.set(s.id!)">
            <span class="node__icon"><ui-icon [name]="specOf(s).icon" /></span>
            <span class="node__body">
              <span class="node__kind">{{ specOf(s).label }} · {{ s.id }}</span>
              <span class="node__summary node__summary--mono">{{ summary(s) }}</span>
            </span>
            @if (result(s); as r) { <span class="node__result" [attr.data-tone]="tone(r.status)">{{ r.text }}</span> }
          </button>
          @if (s.type === 'if') {
            <div class="flow-branch">
              <span class="flow-branch__label">Então</span>
              <ng-container *ngTemplateOutlet="tree; context: { $implicit: s.steps ?? [], parentId: s.id, branch: 'steps' }" />
              <div class="flow__add flow__add--inner"><ui-select placeholder="+ passo no então" [options]="stepOptions" [value]="''" (valueChange)="addInto(s.id!, 'steps', $event)" /></div>
            </div>
            <div class="flow-branch flow-branch--else">
              <span class="flow-branch__label">Senão</span>
              <ng-container *ngTemplateOutlet="tree; context: { $implicit: s.else ?? [], parentId: s.id, branch: 'else' }" />
              <div class="flow__add flow__add--inner"><ui-select placeholder="+ passo no senão" [options]="stepOptions" [value]="''" (valueChange)="addInto(s.id!, 'else', $event)" /></div>
            </div>
          }
          @if (s.type === 'forEach') {
            <div class="flow-branch">
              <span class="flow-branch__label">Para cada {{ s.params['as'] || 'item' }}</span>
              <ng-container *ngTemplateOutlet="tree; context: { $implicit: s.steps ?? [], parentId: s.id, branch: 'steps' }" />
              <div class="flow__add flow__add--inner"><ui-select placeholder="+ passo por item" [options]="stepOptions" [value]="''" (valueChange)="addInto(s.id!, 'steps', $event)" /></div>
            </div>
          }
        </div>
      }
      @if (!parentId) {
        <span class="flow__link flow__link--end" aria-hidden="true"></span>
        <div class="flow__add"><ui-select placeholder="+ Adicionar passo" [options]="stepOptions" [value]="''" (valueChange)="addRoot($event)" /></div>
      }
    </ng-template>
  `,
})
export class FlowTab {
  readonly def = model.required<AppDefinition>();
  readonly appId = input.required<string>();
  /** Salva o rascunho antes do teste (o teste roda o que está salvo). true = salvou. */
  readonly save = input.required<() => Promise<boolean>>();
  private readonly api = inject(Api);
  private destroyed = false;

  protected readonly steps = STEPS;
  protected readonly palette = PALETTE;
  protected readonly bodyVar = '{{trigger.body.…}}';
  protected readonly stepOptions = PALETTE.flatMap((g) => g.types).map((t) => ({ value: t, label: STEPS[t].label }));
  protected readonly triggerLabels: Record<string, string> = { manual: 'Manual', schedule: 'Agendado', webhook: 'Webhook', call: 'Chamado por outro projeto' };
  protected readonly triggerOptions = [
    { value: 'manual', label: 'Manual (Executar agora)' }, { value: 'schedule', label: 'Agendado' }, { value: 'webhook', label: 'Webhook (POST)' },
    { value: 'call', label: 'Chamado por mini app ou formulário' },
  ];
  protected readonly open = '{{';
  protected readonly close = '}}';
  protected readonly typeOptions = Object.entries(VARIABLE_TYPES).map(([value, t]) => ({ value, label: t.label }));
  protected readonly inputsError = computed(() => (this.flow().trigger.type === 'call' ? inputsProblem(this.flow().trigger.inputs ?? []) : null));
  protected readonly frequencies = [
    { value: 'cron', label: 'Personalizado (cron)' }, { value: 'hourly', label: 'A cada hora' }, { value: 'daily', label: 'Diário' }, { value: 'weekly', label: 'Semanal' },
  ];
  protected readonly weekdays = WEEKDAYS.map((d, i) => ({ value: String(i), label: d }));
  protected readonly retryOptions = ['0', '1', '2', '3', '4', '5'];

  protected readonly selected = signal<string>('trigger');
  protected readonly testing = signal(false);
  protected readonly testRun = signal<RunDetail | null>(null);
  protected readonly testError = signal<string | null>(null);
  /** Id em edição (pode estar inválido); volta ao id do passo ao trocar a seleção. */
  protected readonly idDraft = linkedSignal(() => this.selected());
  protected readonly idError = linkedSignal<string | null>(() => (this.selected(), null));

  protected readonly flow = computed<WorkflowDef>(() => flowOf(this.def()));
  protected readonly step = computed(() => {
    const id = this.selected();
    return id === 'trigger' ? null : (locate(this.flow().actions, id)?.step ?? null);
  });
  protected readonly variables = computed(() => this.flow().variables ?? []);
  protected readonly variable = computed(() => {
    const id = this.selected();
    return id.startsWith('var:') ? (this.variables().find((v) => v.name === id.slice(4)) ?? null) : null;
  });
  /** Saída do último teste por passo: os caminhos reais entram no autocomplete. */
  private readonly outputs = computed(() =>
    Object.fromEntries((this.testRun()?.steps ?? []).filter((s) => s.stepId).map((s) => [s.stepId!, s.output])));
  /** O que existe no ponto selecionado: no gatilho ainda não há saída de passo; com uma variável aberta, tudo (fim). */
  protected readonly vars = computed<VarItem[]>(() =>
    variablesAt(this.def(), this.selected().startsWith('var:') ? null : this.selected(), this.outputs()));
  /** Caminhos para o apelido (sem a própria lista de variáveis nem segredos). */
  protected readonly paths = computed(() => this.vars().filter((v) => v.group !== 'Variáveis' && v.group !== 'Segredos'));
  protected readonly triggerText = computed(() => flowTriggerSummary(this.flow().trigger));
  protected readonly triggerIcon = computed(() => ({ manual: 'manual', webhook: 'webhook', schedule: 'schedule', call: 'external' })[this.flow().trigger.type as string] ?? 'manual');
  protected readonly webhookUrl = computed(() => this.api.flowWebhookUrl(this.appId()));
  private readonly results = computed(() => resultsByStep(this.testRun()?.steps ?? []));
  protected readonly testText = computed(() => {
    if (this.testError()) return this.testError();
    const run = this.testRun()?.run;
    if (!run) return 'Roda o rascunho salvo; e-mails só vão para o log.';
    const label = RUN_STATUS[run.status]?.label ?? run.status;
    return run.error ? `${label}: ${run.error}` : `Teste #${run.number}: ${label}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected specOf = (s: ActionDef) => STEPS[s.type as StepType] ?? STEPS.callApi;
  protected summary = (s: ActionDef) => stepSummary(s);
  protected result = (s: ActionDef) => (s.id ? this.results()[s.id] : undefined);
  protected tone = (status: string) => RUN_STATUS[status]?.tone ?? 'neutral';
  protected entries = (s: ActionDef) => Object.entries(s.values).map(([key, value]) => ({ key, value: value ?? '' }));
  protected readonly selectedVar = computed(() => this.variable()?.name ?? null);
  protected readonly varProblem = computed(() => {
    const v = this.variable();
    return v ? variableProblem(this.flow(), v, loopNames(this.flow())) : null;
  });
  /** Nome digitado para a variável aberta: inválido não renomeia. */
  protected readonly nameProblem = (name: string) => {
    const v = this.variable();
    if (!v) return null;
    if (this.variables().some((x) => x !== v && x.name.toLowerCase() === name.toLowerCase())) return 'Já existe uma variável com este nome.';
    return variableProblem(this.flow(), { ...v, name }, loopNames(this.flow()));
  };
  /** Valor do caminho no último teste (tooltip). */
  protected readonly lastValue = (path: string) => testValue(this.flow(), path, this.outputs());
  protected output(s: ActionDef): string | null {
    const found = (this.testRun()?.steps ?? []).filter((x) => x.stepId === s.id).at(-1);
    if (!found) return null;
    if (found.error) return found.error;
    try {
      return JSON.stringify(JSON.parse(found.output ?? 'null'), null, 2);
    } catch {
      return found.output;
    }
  }

  /** Toda alteração passa por aqui: clona, muta e emite a nova definição. */
  private edit(fn: (d: AppDefinition) => void) {
    const d = structuredClone(this.def());
    fn(d);
    this.def.set(d);
  }

  private selectStep(id: string) {
    this.selected.set(id);
  }

  private current = (d: AppDefinition) => locate(flowOf(d).actions, this.selected())!.step;

  protected add(type: StepType) {
    let id = '';
    this.edit((d) => (id = insertNear(d, type, this.selected() === 'trigger' ? null : this.selected()).id!));
    this.selectStep(id);
  }

  protected addRoot(type: string) {
    if (!type) return;
    let id = '';
    this.edit((d) => (id = insertNear(d, type as StepType, null).id!));
    this.selectStep(id);
  }

  protected addInto(parentId: string, branch: 'steps' | 'else', type: string) {
    if (!type) return;
    let id = '';
    this.edit((d) => (id = insertNear(d, type as StepType, parentId, branch).id!));
    this.selectStep(id);
  }

  protected remove() {
    this.edit((d) => removeStep(d, this.selected()));
    this.selected.set('trigger');
  }

  protected move(delta: -1 | 1) {
    this.edit((d) => moveStep(d, this.selected(), delta));
  }

  protected setId(value: string) {
    this.idDraft.set(value);
    const problem = idProblem(this.def(), this.selected(), value);
    this.idError.set(problem);
    if (problem || value === this.selected()) return;
    const old = this.selected();
    this.edit((d) => renameStep(d, old, value));
    this.selected.set(value);
  }

  protected setParam(key: string, value: string) {
    this.edit((d) => (this.current(d).params[key] = value));
  }

  protected setCondition(condition: ConditionDef) {
    this.edit((d) => (this.current(d).condition = condition));
  }

  protected setRetries(value: string) {
    this.edit((d) => (this.current(d).retries = Number(value) || 0));
  }

  protected setTimeout(value: string) {
    this.edit((d) => (this.current(d).timeoutSeconds = Number(value) > 0 ? Number(value) : null));
  }

  protected addValue() {
    this.edit((d) => {
      const s = this.current(d);
      let n = Object.keys(s.values).length + 1;
      while (`campo${n}` in s.values) n++;
      s.values[`campo${n}`] = '';
    });
  }

  protected setValue(key: string, value: string) {
    this.edit((d) => (this.current(d).values[key] = value));
  }

  protected renameValue(oldKey: string, newKey: string) {
    if (!newKey || newKey === oldKey) return;
    this.edit((d) => {
      const s = this.current(d);
      if (newKey in s.values) return;
      s.values = Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k === oldKey ? newKey : k, v]));
    });
  }

  protected removeValue(key: string) {
    this.edit((d) => delete this.current(d).values[key]);
  }

  // ---------- Variáveis ----------

  protected newVariable() {
    let name = '';
    this.edit((d) => (name = addVariable(flowOf(d)).name));
    this.selected.set(`var:${name}`);
  }

  /** "Guardar resposta/corpo em variável": cria um apelido (objeto) do caminho e abre para renomear. */
  protected saveToVariable(base: string, from: string) {
    let name = '';
    this.edit((d) => (name = addVariable(flowOf(d), base, 'object', from).name));
    this.selected.set(`var:${name}`);
  }

  protected renameVar(oldName: string, name: string) {
    this.edit((d) => renameVariable(flowOf(d), oldName, name));
    this.selected.set(`var:${name}`);
  }

  protected setVar(name: string, key: 'type' | 'default' | 'from', value: string) {
    this.edit((d) => {
      const v = flowOf(d).variables!.find((x) => x.name === name)!;
      if (key === 'type') v.type = value as VariableType;
      else v[key] = value || null;
    });
  }

  protected deleteVariable(name: string) {
    this.edit((d) => removeVariable(flowOf(d), name));
    this.selected.set('trigger');
  }

  protected setOps(ops: TransformOp[]) {
    this.edit((d) => (this.current(d).ops = ops));
  }

  protected setTriggerType(type: string) {
    this.edit((d) => {
      const t = flowOf(d).trigger;
      t.type = (type || 'manual') as WorkflowDef['trigger']['type'];
      if (t.type === 'schedule' && !t.frequency) Object.assign(t, { frequency: 'cron', cron: '0 8 * * 1-5' });
      if (t.type === 'webhook' && !t.webhookKey) t.webhookKey = randomKey();
    });
  }

  protected setTrigger(key: 'frequency' | 'cron' | 'time' | 'dayOfWeek', value: string) {
    this.edit((d) => {
      const t = flowOf(d).trigger;
      if (key === 'frequency') t.frequency = (value || null) as Frequency | null;
      else if (key === 'dayOfWeek') t.dayOfWeek = value === '' ? null : Number(value);
      else t[key] = value || null;
    });
  }

  // ---------- Entradas do gatilho "call" ----------

  protected addInput() {
    this.edit((d) => {
      const list = (flowOf(d).trigger.inputs ??= []);
      let n = list.length + 1;
      while (list.some((x) => x.name === `entrada${n}`)) n++;
      list.push({ name: `entrada${n}`, type: 'text', default: null });
    });
  }

  protected setInput(i: number, key: 'name' | 'type' | 'default', value: string) {
    this.edit((d) => {
      const wf = flowOf(d);
      const inp = wf.trigger.inputs![i];
      if (key === 'name') renameInput(wf, inp.name, value.trim());
      else if (key === 'type') inp.type = value as VariableType;
      else inp.default = value || null;
    });
  }

  protected removeInput(i: number) {
    this.edit((d) => flowOf(d).trigger.inputs!.splice(i, 1));
  }

  protected newKey() {
    this.edit((d) => (flowOf(d).trigger.webhookKey = randomKey()));
  }

  /** Salva, enfileira o rascunho e acompanha até terminar; o resultado aparece em cada passo. */
  protected async test() {
    this.testing.set(true);
    this.testError.set(null);
    try {
      if (!(await this.save()())) return;
      const run = await this.api.runNow(this.appId(), 'draft');
      for (let i = 0; i < TEST_MAX_POLLS && !this.destroyed; i++) {
        const detail = await this.api.runDetail(this.appId(), 'draft', run.id);
        this.testRun.set(detail);
        if (isDone(detail.run.status)) break;
        await new Promise((r) => setTimeout(r, TEST_POLL_MS));
      }
    } catch (e) {
      this.testError.set(errorMessage(e));
    } finally {
      this.testing.set(false);
    }
  }
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
