import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { ActionDef, ActionType, AppDefinition, AppSummary, ConditionDef, Frequency, TransformOp, TriggerType, VariableType, WorkflowDef } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import {
  ACTIONS, ACTION_TYPES, TRIGGER_LABELS, WEEKDAYS, actionSummary, addWorkflow, conditionSummary, newAction, triggerSummary,
} from './editor-ops';
import { PropControl } from './prop-control';
import { ConditionEditor } from './condition-editor';
import { hasCondition, orNull } from './condition-ops';
import { TransformOpsEditor } from './transform-ops-editor';
import { VarEditor } from './var-editor';
import { VarPanel } from './var-panel';
import { VARIABLE_TYPES, addVariable, autoMap, automationVarsAt, pageInputs, prefillNames, removeVariable, renameVariable, variableProblem } from './variable-ops';

/** Nó aberto à direita: gatilho, condição, passo (índice) ou variável ('var:nome'). */
type Node = 'trigger' | 'condition' | number | `var:${string}`;

/**
 * Workflows visuais (referência: n8n). Nós em coluna ligados por conectores: Gatilho → Condição (opcional) → Passos.
 * Clicar num nó abre os parâmetros à direita. O canvas em grafo fica para depois (DOCS/PRD-WORKFLOWS.md).
 */
@Component({
  selector: 'app-workflows-tab',
  imports: [UI, LAYOUT, PropControl, ConditionEditor, VarPanel, VarEditor, TransformOpsEditor],
  template: `
    @let d = def();
    <div class="editor">
      <aside class="panel panel--left">
        <div class="panel__section panel__section--grow">
          <div class="panel__head">
            <h4>Automações</h4>
            <button uiButton variant="ghost" class="icon-btn" title="Nova automação" aria-label="Nova automação" (click)="create()"><ui-icon name="plus" /></button>
          </div>
          @for (w of d.workflows; track w.id) {
            <button type="button" class="tree-item" [class.active]="w.id === wf()?.id" (click)="open(w.id)">
              <ui-icon class="tree-item__icon" [name]="w.trigger.type" /><span class="tree-item__text">{{ w.name }}</span>
            </button>
          } @empty {
            <p class="panel__hint">Nenhuma automação ainda.</p>
          }
        </div>
        @if (wf(); as w) {
          <app-var-panel [variables]="w.variables ?? []" [items]="vars()" [selected]="variable()?.name ?? null"
            (select)="openVar($event)" (create)="newVariable()" />
        }
      </aside>

      @if (wf(); as w) {
        <section class="canvas canvas--dots">
          <div class="flow">
            <button type="button" class="node node--trigger" [class.selected]="node() === 'trigger'" (click)="node.set('trigger')">
              <span class="node__icon"><ui-icon [name]="w.trigger.type" /></span>
              <span class="node__body">
                <span class="node__kind">Gatilho</span>
                <strong class="node__title">{{ triggerLabels[w.trigger.type] }}</strong>
                <span class="node__summary">{{ triggerText() }}</span>
              </span>
            </button>

            <span class="flow__link" aria-hidden="true"></span>
            @if (conditionText(); as text) {
              <button type="button" class="node node--condition" [class.selected]="node() === 'condition'" (click)="node.set('condition')">
                <span class="node__icon"><ui-icon name="condition" /></span>
                <span class="node__body">
                  <span class="node__kind">Se</span>
                  <strong class="node__title">{{ text }}</strong>
                  <span class="node__summary">Senão, para aqui</span>
                </span>
              </button>
            } @else {
              <button type="button" class="node node--ghost" [class.selected]="node() === 'condition'" (click)="node.set('condition')">
                <ui-icon name="condition" /> Adicionar condição (opcional)
              </button>
            }

            @for (a of w.actions; track $index; let i = $index) {
              <span class="flow__link" aria-hidden="true"></span>
              <button type="button" class="node" [class.selected]="node() === i" (click)="node.set(i)">
                <span class="node__icon"><ui-icon [name]="a.type" /></span>
                <span class="node__body">
                  <span class="node__kind">Passo {{ i + 1 }}</span>
                  <strong class="node__title">{{ actions[a.type].label }}</strong>
                  <span class="node__summary">{{ stepText(a) }}</span>
                </span>
              </button>
            }

            <span class="flow__link flow__link--end" aria-hidden="true"></span>
            <div class="flow__add">
              <ui-select placeholder="+ Adicionar passo" [options]="actionOptions" [value]="''" (valueChange)="addAction($event)" />
            </div>
          </div>
        </section>

        <aside class="panel panel--right">
          @if (variable(); as v) {
            <app-var-editor [variable]="v" [problem]="varProblem()" [problemFor]="nameProblem" [paths]="paths()" pathPlaceholder="api.response"
              (rename)="renameVar(v.name, $event)" (change)="setVar(v.name, $event.key, $event.value)" (remove)="deleteVariable(v.name)" />
          } @else {
          @switch (node()) {
            @case ('trigger') {
              <div class="panel__section">
                <div class="panel__title"><ui-icon [name]="w.trigger.type" /> Gatilho</div>
              </div>
              <div class="panel__section">
                <ui-input label="Nome da automação" [value]="w.name" (valueChange)="rename($event)" />
                <ui-select label="Quando" [options]="triggers" [value]="w.trigger.type" (valueChange)="setTrigger($event)" />
                @switch (w.trigger.type) {
                  @case ('click') {
                    <p class="panel__hint">Ligue esta automação a um botão na aba Design.</p>
                  }
                  @case ('schedule') {
                    <ui-select label="Frequência" [options]="frequencies" [value]="w.trigger.frequency ?? ''" (valueChange)="setSchedule('frequency', $event)" />
                    @if (w.trigger.frequency === 'weekly') {
                      <ui-select label="Dia" [options]="weekdays" [value]="w.trigger.dayOfWeek == null ? '' : '' + w.trigger.dayOfWeek"
                        (valueChange)="setSchedule('dayOfWeek', $event)" />
                    }
                    @if (w.trigger.frequency === 'daily' || w.trigger.frequency === 'weekly') {
                      <ui-input label="Horário" type="time" [value]="w.trigger.time ?? ''" (valueChange)="setSchedule('time', $event)" />
                    }
                    <p class="panel__hint">
                      Roda na versão publicada, como "agendador" (horário do servidor).
                      Variáveis: <span ngNonBindable>{{today}} e {{now}}</span>.
                    </p>
                    <div class="row" style="margin-top: 10px">
                      <button uiButton (click)="runNow()" [disabled]="running()"><ui-icon name="play" /> Executar agora no rascunho</button>
                    </div>
                    @if (runResult(); as r) {
                      <p class="panel__hint">{{ r }}</p>
                    }
                  }
                  @default {
                    <ui-select label="Tabela" [options]="tableOptions()" [value]="w.trigger.tableId ?? ''" (valueChange)="setTriggerTable($event)" />
                    <p class="panel__hint">Também dispara quando outra automação cria ou atualiza registros nesta tabela.</p>
                  }
                }
              </div>
              <div class="panel__section">
                <button uiButton variant="danger" (click)="remove()">Excluir automação</button>
              </div>
            }
            @case ('condition') {
              <div class="panel__section">
                <div class="panel__title"><ui-icon name="condition" /> Condição</div>
                <p class="panel__hint">Sem condição, os passos rodam sempre. Use um campo do registro, um campo de entrada da página ou user.*.</p>
              </div>
              <div class="panel__section">
                <app-condition-editor [condition]="w.condition" [suggestions]="vars()" (changed)="setCondition($event)" />
              </div>
              @if (hasCondition(w.condition)) {
                <div class="panel__section">
                  <button uiButton variant="danger" (click)="clearCondition()">Remover condição</button>
                </div>
              }
            }
            @default {
              @let i = stepIndex();
              @if (w.actions[i]; as a) {
                <div class="panel__section">
                  <div class="panel__title"><ui-icon [name]="a.type" /> Passo {{ i + 1 }}: {{ actions[a.type].label }}</div>
                </div>
                <div class="panel__section">
                  @for (s of actions[a.type].params; track s.key) {
                    <app-prop-control [spec]="s" [def]="d" [value]="a.params[s.key] ?? ''" [suggestions]="vars()" (valueChange)="setParam(i, s.key, $event)" />
                  }
                  @if (actions[a.type].usesValues) {
                    @for (f of fieldsOf(a.params['tableId']); track f.id) {
                      <ui-input [label]="'Valor de ' + f.name" [value]="a.values[f.name] ?? ''" [suggestions]="vars()" (valueChange)="setValue(i, f.name, $event)" />
                    }
                  }
                  @if (a.type === 'transform') {
                    <app-transform-ops-editor [ops]="a.ops ?? []" [variables]="w.variables ?? []" [suggestions]="vars()" [inputPlaceholder]="responseVar"
                      (opsChange)="setOps(i, $event)" (createVariable)="newVariable()" />
                  }
                  @if (a.type === 'startFlow') {
                    <ui-select label="Workflow" [options]="flowOptions()" [value]="a.params['flowId'] ?? ''" placeholder="Escolha…" (valueChange)="setTarget(i, 'flowId', $event)" />
                    @if (target(); as t) {
                      @if (t.problem) { <p class="runner__problem small">{{ t.problem }}</p> }
                      @for (n of t.fields; track n.name) {
                        <ui-input [label]="n.label" [mono]="true" [value]="a.values[n.name] ?? ''" [suggestions]="vars()" (valueChange)="setValue(i, n.name, $event)" />
                      }
                    }
                    <p class="panel__hint">Roda em segundo plano no mesmo ambiente: o teste chama o rascunho do workflow; produção, a versão publicada. Só aparecem workflows deste workspace.</p>
                  }
                  @if (a.type === 'openLink') {
                    <ui-segmented label="Destino" [columns]="2" [options]="linkModes" [value]="a.params['url'] != null ? 'url' : 'project'" (valueChange)="setLinkMode(i, $event)" />
                    @if (a.params['url'] != null) {
                      <ui-input label="Link" [mono]="true" placeholder="https://intranet.corp.local/pedido?id={{ lb }}id{{ rb }}" [value]="a.params['url']"
                        [suggestions]="vars()" (valueChange)="setParam(i, 'url', $event)" />
                      <p class="panel__hint">http(s) ou um caminho do site (/...). Os valores de {{ lb }}variáveis{{ rb }} entram escapados.</p>
                    } @else {
                      <ui-select label="Projeto" [options]="linkOptions()" [value]="a.params['projectId'] ?? ''" placeholder="Escolha…" (valueChange)="setTarget(i, 'projectId', $event)" />
                      @if (target(); as t) {
                        @if (t.problem) { <p class="runner__problem small">{{ t.problem }}</p> }
                        @if (t.fields.length) { <p class="panel__hint">Já chega preenchido (opcional):</p> }
                        @for (n of t.fields; track n.name) {
                          <ui-input [label]="n.label" [value]="a.values[n.name] ?? ''" [suggestions]="vars()" (valueChange)="setValue(i, n.name, $event)" />
                        }
                      }
                    }
                    <ui-checkbox label="Abrir em nova aba" [checked]="a.params['newTab'] === 'true'" (checkedChange)="setParam(i, 'newTab', $event ? 'true' : '')" />
                    @if (w.trigger.type !== 'click') { <p class="runner__problem small">Só tem efeito em automações de clique: precisa de alguém com o app aberto.</p> }
                  }
                  @if (a.type === 'callApi') {
                    <button uiButton variant="ghost" (click)="saveResponse()"><ui-icon name="plus" /> Guardar resposta em variável</button>
                  }
                  <p class="panel__hint" ngNonBindable>Digite {{ para ver as variáveis deste passo, ou arraste do painel à esquerda.</p>
                </div>
                <div class="panel__section">
                  <button uiButton variant="danger" (click)="removeAction(i)">Remover passo</button>
                </div>
              }
            }
          }
          }
        </aside>
      } @else {
        <section class="canvas canvas--dots canvas--center">
          <app-empty title="Nenhuma automação" text="Automações reagem a cliques, registros ou horários e executam passos em ordem.">
            <button uiButton variant="primary" (click)="create()"><ui-icon name="plus" /> Nova automação</button>
          </app-empty>
        </section>
      }
    </div>
  `,
})
export class WorkflowsTab {
  readonly def = model.required<AppDefinition>();
  readonly appId = input.required<string>();
  /** Workspace do projeto: as ações entre projetos só listam projetos dele. */
  readonly workspaceId = input.required<string>();
  private readonly api = inject(Api);

  protected readonly frequencies = [
    { value: 'hourly', label: 'A cada hora' }, { value: 'daily', label: 'Diário' }, { value: 'weekly', label: 'Semanal' },
  ];
  protected readonly weekdays = WEEKDAYS.map((d, i) => ({ value: String(i), label: d }));
  protected readonly running = signal(false);
  protected readonly runResult = signal<string | null>(null);
  protected readonly triggerLabels = TRIGGER_LABELS;
  protected readonly node = signal<Node>('trigger');
  protected readonly stepIndex = computed(() => { const n = this.node(); return typeof n === 'number' ? n : -1; });
  protected readonly variable = computed(() => {
    const n = this.node();
    return typeof n === 'string' && n.startsWith('var:') ? ((this.wf()?.variables ?? []).find((v) => v.name === n.slice(4)) ?? null) : null;
  });
  /** O que existe no nó aberto: no gatilho/condição, o início; no passo, o que vem antes; numa variável, tudo (fim). */
  protected readonly vars = computed(() => {
    const w = this.wf();
    if (!w) return [];
    const n = this.node();
    return automationVarsAt(this.def(), w, typeof n === 'number' ? n : this.variable() ? w.actions.length : 0);
  });
  /** Caminhos para o apelido (sem as próprias variáveis). */
  protected readonly paths = computed(() => this.vars().filter((v) => v.group !== 'Variáveis'));
  /** Campos e inputs: a variável não pode escondê-los (mesma regra do back). */
  private readonly contextNames = computed(() => [...this.def().tables.flatMap((t) => t.fields.map((f) => f.name)), ...pageInputs(this.def()).map((i) => i.name)]);
  protected readonly varProblem = computed(() => {
    const v = this.variable();
    const w = this.wf();
    return v && w ? variableProblem(w, v, this.contextNames()) : null;
  });
  protected readonly nameProblem = (name: string) => {
    const v = this.variable();
    const w = this.wf();
    if (!v || !w) return null;
    if ((w.variables ?? []).some((x) => x !== v && x.name.toLowerCase() === name.toLowerCase())) return 'Já existe uma variável com este nome.';
    return variableProblem(w, { ...v, name }, this.contextNames());
  };
  protected readonly triggerText = computed(() => { const w = this.wf(); return w ? triggerSummary(this.def(), w.trigger) : ''; });
  protected readonly conditionText = computed(() => conditionSummary(this.wf()?.condition ?? null));

  protected readonly actions = ACTIONS;
  protected readonly actionOptions = ACTION_TYPES.map((t) => ({ value: t, label: ACTIONS[t].label }));
  /** Manual e webhook (com chave própria) são só de projetos de workflow. */
  protected readonly triggers = (Object.keys(TRIGGER_LABELS) as TriggerType[])
    .filter((t) => t !== 'manual' && t !== 'webhook' && t !== 'call').map((t) => ({ value: t, label: TRIGGER_LABELS[t] }));
  protected readonly hasCondition = hasCondition;
  protected readonly wfId = signal<string | null>(null);
  protected readonly wf = computed<WorkflowDef | null>(() => {
    const list = this.def().workflows;
    return list.find((w) => w.id === this.wfId()) ?? list[0] ?? null;
  });
  protected readonly tableOptions = computed(() => this.def().tables.map((t) => ({ value: t.id, label: t.name })));

  // ---------- Outros projetos do workspace (Iniciar workflow / Abrir projeto ou link) ----------
  protected readonly lb = '{{';
  protected readonly rb = '}}';
  protected readonly linkModes = [{ value: 'project', label: 'Projeto' }, { value: 'url', label: 'Link' }];
  private readonly projects = signal<AppSummary[]>([]);
  protected readonly flowOptions = computed(() => this.projects().filter((p) => p.kind === 'workflow').map((p) => ({ value: p.id, label: p.name + (p.publishedVersion ? '' : ' (rascunho)') })));
  protected readonly linkOptions = computed(() => this.projects().filter((p) => p.kind !== 'workflow')
    .map((p) => ({ value: p.id, label: `${p.name} · ${p.kind === 'form' ? 'Formulário' : 'Mini app'}${p.publishedVersion ? '' : ' (rascunho)'}` })));
  /** Campos do projeto escolhido no passo aberto: entradas do workflow ou o que o formulário/mini app aceita pré-preenchido. */
  protected readonly target = signal<{ id: string; fields: { name: string; label: string }[]; problem: string | null } | null>(null);
  private readonly targetId = computed(() => {
    const a = this.wf()?.actions[this.stepIndex()];
    return a?.type === 'startFlow' ? (a.params['flowId'] ?? '') : a?.type === 'openLink' ? (a.params['projectId'] ?? '') : '';
  });

  constructor() {
    this.api.apps().then((list) => this.projects.set(list.filter((p) => p.workspaceId === this.workspaceId() && p.id !== this.appId())), () => undefined);
    effect(() => {
      const id = this.targetId();
      untracked(() => this.loadTarget(id));
    });
  }

  private async loadTarget(id: string) {
    if (!id) return this.target.set(null);
    try {
      const app = await this.api.app(id);
      const def = app.published ?? app.draft;
      if (def.automation) {
        const t = def.workflows[0]?.trigger;
        const fields = (t?.inputs ?? []).map((v) => ({ name: v.name, label: `${v.name} (${VARIABLE_TYPES[v.type]?.label ?? v.type})` }));
        const problem = t?.type !== 'call' ? 'Esse workflow precisa do gatilho "Chamado por mini app ou formulário".'
          : app.published ? null : 'Workflow ainda não publicado: só funciona no teste (rascunho).';
        this.target.set({ id, fields, problem });
      } else {
        this.target.set({ id, fields: prefillNames(def).map((n) => ({ name: n, label: n })), problem: app.published ? null : 'Ainda não publicado: só abre no teste (rascunho).' });
      }
    } catch {
      this.target.set({ id, fields: [], problem: 'Você não gerencia esse projeto: não dá para listar os campos dele.' });
    }
  }

  /** Escolher o workflow já liga as entradas aos valores de mesmo nome deste ponto (ex.: nome ← {{Nome}}). */
  protected async setTarget(i: number, key: 'flowId' | 'projectId', id: string) {
    this.edit((w) => {
      w.actions[i].params[key] = id;
      w.actions[i].values = {};
    });
    await this.loadTarget(id);
    const t = this.target();
    if (key === 'flowId' && t?.id === id && t.fields.length) {
      const available = automationVarsAt(this.def(), this.wf()!, i).filter((v) => v.group !== 'Usuário' && !v.derived).map((v) => v.value);
      this.edit((w) => (w.actions[i].values = autoMap(t.fields.map((f) => f.name), available, w.actions[i].values)));
    }
  }

  protected setLinkMode(i: number, mode: string) {
    this.edit((w) => {
      const p = w.actions[i].params;
      if (mode === 'url') { delete p['projectId']; p['url'] = p['url'] ?? ''; } else { delete p['url']; p['projectId'] = p['projectId'] ?? ''; }
      w.actions[i].values = {};
    });
  }

  /** Resumo do passo; nas ações entre projetos, o nome do projeto escolhido. */
  protected stepText(a: ActionDef) {
    const id = a.type === 'startFlow' ? a.params['flowId'] : a.type === 'openLink' ? a.params['projectId'] : null;
    const name = id ? this.projects().find((p) => p.id === id)?.name : null;
    if (name) return a.type === 'startFlow' ? `Inicia ${name}` : `Abre ${name}`;
    return actionSummary(this.def(), a);
  }

  protected open(id: string) {
    this.wfId.set(id);
    this.node.set('trigger');
  }

  protected fieldsOf(tableId: string | null | undefined) {
    return this.def().tables.find((t) => t.id === tableId)?.fields ?? [];
  }

  private edit(fn: (w: WorkflowDef, d: AppDefinition) => void) {
    const d = structuredClone(this.def());
    const target = d.workflows.find((w) => w.id === this.wf()?.id);
    if (target) fn(target, d);
    this.def.set(d);
  }

  protected create() {
    const d = structuredClone(this.def());
    this.wfId.set(addWorkflow(d).id);
    this.node.set('trigger');
    this.def.set(d);
  }

  protected remove() {
    this.edit((w, d) => (d.workflows = d.workflows.filter((x) => x.id !== w.id)));
    this.wfId.set(null);
    this.node.set('trigger');
  }

  protected rename(name: string) {
    this.edit((w) => (w.name = name));
  }

  protected setTrigger(type: string) {
    this.edit((w) => {
      w.trigger = { type: (type || 'click') as TriggerType, tableId: type === 'recordCreated' || type === 'recordUpdated' ? w.trigger.tableId : null };
      if (w.trigger.type === 'schedule') Object.assign(w.trigger, { frequency: 'daily', time: '08:00', dayOfWeek: null });
    });
  }

  protected setSchedule(key: 'frequency' | 'time' | 'dayOfWeek', value: string) {
    this.edit((w) => {
      if (key === 'frequency') w.trigger.frequency = (value || null) as Frequency | null;
      else if (key === 'time') w.trigger.time = value || null;
      else w.trigger.dayOfWeek = value === '' ? null : Number(value);
    });
  }

  /** Testa a automação agendada no rascunho (salve antes: roda a versão salva). */
  protected async runNow() {
    const wf = this.wf();
    if (!wf) return;
    this.running.set(true);
    try {
      const r = await this.api.runWorkflow(this.appId(), 'draft', wf.id, {});
      this.runResult.set(r.log.join(' ') || 'Executada.');
    } catch (e) {
      this.runResult.set(errorMessage(e));
    } finally {
      this.running.set(false);
    }
  }

  protected setTriggerTable(tableId: string) {
    this.edit((w) => (w.trigger.tableId = tableId || null));
  }

  /** Condição com campo vazio é ignorada pelo backend (sempre verdadeira). */
  protected setCondition(condition: ConditionDef) {
    this.edit((w) => (w.condition = orNull(condition)));
  }

  protected clearCondition() {
    this.edit((w) => (w.condition = null));
    this.node.set('trigger');
  }

  /** Novo passo entra no fim e já abre os parâmetros. */
  protected addAction(type: string) {
    if (!type) return;
    let index = 0;
    this.edit((w) => (index = w.actions.push(newAction(type as ActionType)) - 1));
    this.node.set(index);
  }

  protected removeAction(i: number) {
    this.edit((w) => w.actions.splice(i, 1));
    this.node.set(i > 0 ? i - 1 : 'trigger');
  }

  protected setParam(i: number, key: string, value: string) {
    this.edit((w) => (w.actions[i].params[key] = value));
  }

  protected setValue(i: number, field: string, value: string) {
    this.edit((w) => (w.actions[i].values[field] = value));
  }

  protected setOps(i: number, ops: TransformOp[]) {
    this.edit((w) => (w.actions[i].ops = ops));
  }

  // ---------- Variáveis da automação ----------

  protected readonly responseVar = '{{resposta.campo}}';

  protected openVar(name: string) {
    this.node.set(`var:${name}`);
  }

  protected newVariable() {
    let name = '';
    this.edit((w) => (name = addVariable(w).name));
    this.node.set(`var:${name}`);
  }

  /** "Guardar resposta em variável": apelido (objeto) da resposta do Chamar API. */
  protected saveResponse() {
    let name = '';
    this.edit((w) => (name = addVariable(w, 'resposta', 'object', 'api.response').name));
    this.node.set(`var:${name}`);
  }

  protected renameVar(oldName: string, name: string) {
    this.edit((w) => renameVariable(w, oldName, name));
    this.node.set(`var:${name}`);
  }

  protected setVar(name: string, key: 'type' | 'default' | 'from', value: string) {
    this.edit((w) => {
      const v = w.variables!.find((x) => x.name === name)!;
      if (key === 'type') v.type = value as VariableType;
      else v[key] = value || null;
    });
  }

  protected deleteVariable(name: string) {
    this.edit((w) => removeVariable(w, name));
    this.node.set('trigger');
  }
}
