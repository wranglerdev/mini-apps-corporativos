import { Component, computed, inject, input, model, signal } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { ActionDef, ActionType, AppDefinition, ConditionDef, Frequency, TransformOp, TriggerType, VariableType, WorkflowDef } from '../../core/models';
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
import { addVariable, automationVarsAt, pageInputs, removeVariable, renameVariable, variableProblem } from './variable-ops';

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
    .filter((t) => t !== 'manual' && t !== 'webhook').map((t) => ({ value: t, label: TRIGGER_LABELS[t] }));
  protected readonly hasCondition = hasCondition;
  protected readonly wfId = signal<string | null>(null);
  protected readonly wf = computed<WorkflowDef | null>(() => {
    const list = this.def().workflows;
    return list.find((w) => w.id === this.wfId()) ?? list[0] ?? null;
  });
  protected readonly tableOptions = computed(() => this.def().tables.map((t) => ({ value: t.id, label: t.name })));

  protected stepText(a: ActionDef) {
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
