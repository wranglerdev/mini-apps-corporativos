import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AppDefinition, AppDetail, AppVersion } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { DataTab } from './data-tab';
import { DesignTab } from './design-tab';
import { WorkflowsTab } from './workflows-tab';
import { FormResponsesTab } from '../forms/form-responses-tab';
import { FormShareTab } from '../forms/form-share-tab';
import { FormTab } from '../forms/form-tab';
import { FlowTab } from '../flows/flow-tab';
import { RunsTab } from '../flows/runs-tab';
import { SecretsTab } from '../flows/secrets-tab';

type Tab = 'design' | 'data' | 'workflows' | 'settings' | 'questions' | 'responses' | 'share' | 'flow' | 'runs' | 'secrets';

const APP_TABS: { id: Tab; label: string }[] = [
  { id: 'design', label: 'Design' }, { id: 'data', label: 'Dados' }, { id: 'workflows', label: 'Automações' }, { id: 'settings', label: 'Publicação' },
];
/** Formulário (DOCS/PRD-FORMS.md): perguntas, respostas e compartilhar; automações e publicação como nos apps. */
const FORM_TABS: { id: Tab; label: string }[] = [
  { id: 'questions', label: 'Perguntas' }, { id: 'responses', label: 'Respostas' }, { id: 'share', label: 'Compartilhar' },
  { id: 'workflows', label: 'Automações' }, { id: 'settings', label: 'Publicação' },
];
/** Workflow (DOCS/PRD-WORKFLOWS.md): passos, execuções, segredos do workspace e publicação. */
const FLOW_TABS: { id: Tab; label: string }[] = [
  { id: 'flow', label: 'Workflow' }, { id: 'runs', label: 'Execuções' }, { id: 'secrets', label: 'Segredos' }, { id: 'settings', label: 'Publicação' },
];
const TABS_BY_KIND = { app: APP_TABS, form: FORM_TABS, workflow: FLOW_TABS };
const ICON_BY_KIND = { app: 'app', form: 'form', workflow: 'workflow' };

/** Modo builder: edita o rascunho, publica em um clique e gerencia versões. */
@Component({
  selector: 'app-editor-page',
  imports: [UI, LAYOUT, RouterLink, DesignTab, DataTab, WorkflowsTab, FormTab, FormResponsesTab, FormShareTab, FlowTab, RunsTab, SecretsTab],
  template: `
    @if (app(); as a) {
      <app-page width="tool" [notice]="notice()">
        <app-toolbar [back]="{ label: 'Meus apps', link: '/builder' }">
          <div heading class="toolbar__title">
            <ui-icon [name]="icon()" />
            <ui-input [inline]="true" [value]="name()" (valueChange)="name.set($event); dirty.set(true)" />
          </div>
          <ng-container ngProjectAs="[meta]">
            @if (a.publishedVersion) {
              <span class="chip chip--pen">v{{ a.publishedVersion }} em produção</span>
            } @else {
              <span class="chip">Rascunho</span>
            }
            @if (dirty()) {
              <span class="chip chip--warn" title="Alterações não salvas">Não salvo</span>
            }
          </ng-container>
          <ui-segmented nav label="Área do editor" [options]="tabs()" [value]="tab()" (valueChange)="tab.set($any($event))" />
          <ng-container ngProjectAs="[actions]">
            @if (a.publishedVersion && !isFlow()) {
              <a uiButton variant="ghost" [routerLink]="[isForm() ? '/f' : '/run', a.slug]" target="_blank" title="Abrir a versão em produção">
                <ui-icon name="external" /><span class="hide-sm">Produção</span>
              </a>
            }
            @if (!isFlow()) {
              <a uiButton variant="ghost" [routerLink]="[isForm() ? '/f-preview' : '/preview', a.id]" target="_blank" title="Testar o rascunho salvo">
                <ui-icon name="play" /><span class="hide-sm">Testar</span>
              </a>
            }
            <button uiButton (click)="save()" [disabled]="busy()">Salvar</button>
            <button uiButton variant="primary" (click)="publish()" [disabled]="busy()">Publicar</button>
          </ng-container>
        </app-toolbar>

        @switch (tab()) {
          @case ('design') { <app-design-tab [def]="def()" (defChange)="change($event)" /> }
          @case ('questions') { <app-form-tab [def]="def()" (defChange)="change($event)" /> }
          @case ('flow') { <app-flow-tab [def]="def()" (defChange)="change($event)" [appId]="a.id" [save]="saveForTest" /> }
          @case ('runs') { <div class="tool-scroll"><app-runs-tab [appId]="a.id" [published]="a.published" /></div> }
          @case ('secrets') { <div class="tool-scroll"><app-secrets-tab [workspaceId]="a.workspaceId" /></div> }
          @case ('responses') {
            <div class="tool-scroll"><app-form-responses-tab [appId]="a.id" [published]="a.published" /></div>
          }
          @case ('share') {
            <div class="tool-scroll">
              <app-form-share-tab [app]="a" [def]="def()" (defChange)="change($event)" [departments]="departments()"
                (departmentsChange)="departments.set($event); dirty.set(true)" (openAutomations)="tab.set('workflows')" />
            </div>
          }
          @case ('workflows') { <app-workflows-tab [appId]="a.id" [def]="def()" (defChange)="change($event)" /> }
          @case ('data') {
            <div class="tool-scroll"><app-data-tab [appId]="a.id" [def]="def()" (defChange)="change($event)" (pageGenerated)="tab.set('design')" /></div>
          }
          @case ('settings') {
            <div class="tool-scroll">
              <div class="settings">
                <app-section layout="aside" title="Informações" description="Como o app aparece no catálogo e em Meus apps.">
                  <ui-input label="Nome" [value]="name()" (valueChange)="name.set($event); dirty.set(true)" />
                  <ui-input label="Descrição" type="textarea" [value]="description()" (valueChange)="description.set($event); dirty.set(true)" />
                </app-section>

                <app-section layout="aside" title="Acesso e compartilhamento" description="Quem encontra e usa a versão publicada.">
                  @if (!isFlow()) {
                    <ui-checkbox label="Mostrar no catálogo interno" [checked]="inCatalog()" (checkedChange)="inCatalog.set($event); dirty.set(true)" />
                  }
                  <ui-checkbox label="Compartilhar como template na biblioteca" [checked]="isTemplate()" (checkedChange)="isTemplate.set($event); dirty.set(true)" />
                  @if (isFlow()) {
                    <p class="muted small">Workflows rodam em segundo plano: não aparecem no catálogo. Só quem gerencia o workspace edita e vê as execuções.</p>
                  } @else if (isForm()) {
                    <p class="muted small">Quem pode responder e o link ficam em Compartilhar.</p>
                  } @else {
                    <ui-input label="Departamentos com acesso" placeholder="Vazio = todos. Ex.: RH, Financeiro" [value]="departments()"
                      (valueChange)="departments.set($event); dirty.set(true)" />
                    <p class="muted small">Endereço do app publicado: /run/{{ a.slug }}</p>
                  }
                </app-section>

                <app-section layout="aside" title="Versões" description="Cada publicação gera uma versão. Restaurar publica de novo o conteúdo antigo.">
                  @for (v of versions(); track v.id) {
                    <div class="version-row">
                      <div>
                        <strong>Versão {{ v.number }}</strong>
                        <p class="muted small">{{ v.publishedBy }}, {{ when(v.publishedAt) }}</p>
                      </div>
                      <span class="spacer"></span>
                      @if (v.number !== a.publishedVersion) {
                        <button uiButton variant="ghost" (click)="rollback(v.number)">Restaurar esta versão</button>
                      } @else {
                        <span class="chip chip--pen">Em produção</span>
                      }
                    </div>
                  } @empty {
                    <app-empty title="Ainda não publicado" text="Use Publicar no topo da tela quando o rascunho estiver pronto." />
                  }
                </app-section>
              </div>
            </div>
          }
        }
      </app-page>
    }
  `,
})
export class EditorPage {
  readonly id = input.required<string>();
  private readonly api = inject(Api);

  protected readonly kind = computed(() => this.app()?.kind ?? 'app');
  protected readonly isForm = computed(() => this.kind() === 'form');
  protected readonly isFlow = computed(() => this.kind() === 'workflow');
  protected readonly icon = computed(() => ICON_BY_KIND[this.kind()]);
  protected readonly tabs = computed(() => TABS_BY_KIND[this.kind()].map((t) => ({ value: t.id, label: t.label })));
  /** "Testar" do workflow roda o que está salvo: salva antes. */
  protected readonly saveForTest = async () => {
    await this.save();
    return !this.notice()?.error;
  };
  protected readonly app = signal<AppDetail | null>(null);
  protected readonly tab = signal<Tab>('design');
  protected readonly def = signal<AppDefinition>({ pages: [], tables: [], workflows: [] });
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly inCatalog = signal(false);
  protected readonly isTemplate = signal(false);
  protected readonly departments = signal('');
  protected readonly versions = signal<AppVersion[]>([]);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ text: string; error: boolean } | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.run(() => this.load(id)));
    });
  }

  protected when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  protected change(def: AppDefinition) {
    this.def.set(def);
    this.dirty.set(true);
  }

  protected save() {
    return this.run(async () => {
      this.setApp(await this.api.updateApp(this.id(), {
        name: this.name(), description: this.description(), draft: this.def(), inCatalog: this.inCatalog(),
        isTemplate: this.isTemplate(), allowedDepartments: this.departments().split(',').map((d) => d.trim()).filter(Boolean),
      }));
    }, 'Rascunho salvo.');
  }

  protected publish() {
    return this.run(async () => {
      await this.save();
      if (this.notice()?.error) return;
      const v = await this.api.publish(this.id());
      await this.load(this.id());
      this.notice.set({ text: `Publicado como v${v.number}.`, error: false });
    });
  }

  protected rollback(n: number) {
    return this.run(async () => {
      this.setApp(await this.api.rollback(this.id(), n));
      this.versions.set(await this.api.versions(this.id()));
    }, `Versão v${n} restaurada em produção e no rascunho.`);
  }

  private async load(id: string) {
    this.setApp(await this.api.app(id));
    this.versions.set(await this.api.versions(id));
  }

  private setApp(a: AppDetail) {
    const tabs = TABS_BY_KIND[a.kind] ?? APP_TABS;
    if (!tabs.some((t) => t.id === this.tab())) this.tab.set(tabs[0].id);
    this.app.set(a);
    this.def.set(a.draft);
    this.name.set(a.name);
    this.description.set(a.description);
    this.inCatalog.set(a.inCatalog);
    this.isTemplate.set(a.isTemplate);
    this.departments.set(a.allowedDepartments.join(', '));
    this.dirty.set(false);
  }

  private async run(fn: () => Promise<void>, success?: string) {
    this.busy.set(true);
    this.notice.set(null);
    try {
      await fn();
      if (success) this.notice.set({ text: success, error: false });
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
