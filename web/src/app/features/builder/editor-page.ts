import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AppDefinition, AppDetail, AppVersion } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { DataTab } from './data-tab';
import { AUTOSAVE_MS, EDITOR_TABS, EditorTab, editorTab, hasUnpublishedChanges } from './editor-ops';
import { DesignTab } from './design-tab';
import { WorkflowsTab } from './workflows-tab';
import { FormResponsesTab } from '../forms/form-responses-tab';
import { FormShareTab } from '../forms/form-share-tab';
import { FormTab } from '../forms/form-tab';
import { FlowTab } from '../flows/flow-tab';
import { RunsTab } from '../flows/runs-tab';
import { SecretsTab } from '../flows/secrets-tab';

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
            <ui-input [inline]="true" [value]="name()" (valueChange)="name.set($event); touch()" />
          </div>
          <ng-container ngProjectAs="[meta]">
            @if (a.publishedVersion) {
              <span class="chip chip--pen">v{{ a.publishedVersion }} em produção</span>
            } @else {
              <span class="chip">Rascunho</span>
            }
            @if (saving()) {
              <span class="chip" title="Salvando o rascunho automaticamente">Salvando…</span>
            } @else if (autoError(); as e) {
              <span class="chip chip--warn" [title]="e">Erro ao salvar</span>
            } @else if (dirty()) {
              <span class="chip chip--warn" title="Salva sozinho em instantes">Não salvo</span>
            }
          </ng-container>
          <ui-segmented nav label="Área do editor" [options]="tabs()" [value]="tab()" (valueChange)="setTab($any($event))" />
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
            <button uiButton variant="primary" (click)="publish()" [disabled]="busy() || !canPublish()"
              [title]="canPublish() ? 'Publicar o rascunho como nova versão' : 'Nada mudou desde a v' + a.publishedVersion">Publicar</button>
          </ng-container>
        </app-toolbar>

        @switch (tab()) {
          @case ('design') { <app-design-tab [def]="def()" (defChange)="change($event)" /> }
          @case ('perguntas') { <app-form-tab [appId]="a.id" [workspaceId]="a.workspaceId" [def]="def()" (defChange)="change($event)" /> }
          @case ('workflow') { <app-flow-tab [def]="def()" (defChange)="change($event)" [appId]="a.id" [save]="saveForTest" /> }
          @case ('execucoes') { <div class="tool-scroll"><app-runs-tab [appId]="a.id" [published]="a.published" /></div> }
          @case ('segredos') { <div class="tool-scroll"><app-secrets-tab [workspaceId]="a.workspaceId" /></div> }
          @case ('respostas') {
            <div class="tool-scroll"><app-form-responses-tab [appId]="a.id" [published]="a.published" /></div>
          }
          @case ('compartilhar') {
            <div class="tool-scroll">
              <app-form-share-tab [app]="a" [def]="def()" (defChange)="change($event)" [departments]="departments()"
                (departmentsChange)="departments.set($event); touch()" (openAutomations)="setTab('automacoes')" />
            </div>
          }
          @case ('automacoes') { <app-workflows-tab [appId]="a.id" [workspaceId]="a.workspaceId" [def]="def()" (defChange)="change($event)" /> }
          @case ('dados') {
            <div class="tool-scroll"><app-data-tab [appId]="a.id" [def]="def()" (defChange)="change($event)" (pageGenerated)="setTab('design')" /></div>
          }
          @case ('publicacao') {
            <div class="tool-scroll">
              <div class="settings">
                <app-section layout="aside" title="Informações" description="Como o app aparece na Biblioteca e em Meus apps.">
                  <ui-input label="Nome" [value]="name()" (valueChange)="name.set($event); touch()" />
                  <ui-input label="Descrição" type="textarea" [value]="description()" (valueChange)="description.set($event); touch()" />
                </app-section>

                <app-section layout="aside" title="Acesso e compartilhamento" description="Quem encontra e usa a versão publicada.">
                  @if (!isFlow()) {
                    <ui-checkbox label="Mostrar na Biblioteca (apps publicados)" [checked]="inCatalog()" (checkedChange)="inCatalog.set($event); touch()" />
                  }
                  <ui-checkbox label="Compartilhar como template na Biblioteca" [checked]="isTemplate()" (checkedChange)="isTemplate.set($event); touch()" />
                  @if (isFlow()) {
                    <p class="muted small">Workflows rodam em segundo plano: não aparecem na Biblioteca como app. Só quem gerencia o workspace edita e vê as execuções.</p>
                  } @else if (isForm()) {
                    <p class="muted small">Quem pode responder e o link ficam em Compartilhar.</p>
                  } @else {
                    <ui-input label="Departamentos com acesso" placeholder="Vazio = todos. Ex.: RH, Financeiro" [value]="departments()"
                      (valueChange)="departments.set($event); touch()" />
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
  /** ?aba= da URL (withComponentInputBinding): aba ativa persiste em reload e link compartilhado. */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'aba' });
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly kind = computed(() => this.app()?.kind ?? 'app');
  protected readonly isForm = computed(() => this.kind() === 'form');
  protected readonly isFlow = computed(() => this.kind() === 'workflow');
  protected readonly icon = computed(() => ICON_BY_KIND[this.kind()]);
  protected readonly tabs = computed(() => EDITOR_TABS[this.kind()].map((t) => ({ value: t.id, label: t.label })));
  /** "Testar" do workflow roda o que está salvo: salva antes. */
  protected readonly saveForTest = async () => {
    await this.save();
    return !this.notice()?.error;
  };
  protected readonly app = signal<AppDetail | null>(null);
  protected readonly tab = computed(() => editorTab(this.kind(), this.tabParam()));
  protected readonly def = signal<AppDefinition>({ pages: [], tables: [], workflows: [] });
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly inCatalog = signal(false);
  protected readonly isTemplate = signal(false);
  protected readonly departments = signal('');
  protected readonly versions = signal<AppVersion[]>([]);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  /** Salvamento automático em andamento e o erro dele (mostrado no selo, sem banner). */
  protected readonly saving = signal(false);
  protected readonly autoError = signal<string | null>(null);
  /** Conta as edições: um salvamento só substitui o que está na tela se nada mudou enquanto ele ia ao servidor. */
  private readonly rev = signal(0);
  /** Publicar sem mudança desde a última versão não faz sentido: o botão desliga. */
  protected readonly canPublish = computed(() => {
    const a = this.app();
    return !!a && hasUnpublishedChanges(a.draft, a.published, this.dirty());
  });
  protected readonly notice = signal<{ text: string; error: boolean } | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.run(() => this.load(id)));
    });
    // Salva o rascunho sozinho um tempo depois da última edição.
    effect((onCleanup) => {
      this.rev();
      if (!untracked(this.dirty)) return;
      const timer = setTimeout(() => this.autosave(), AUTOSAVE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** Toda edição passa por aqui: marca como não salvo e reinicia a contagem do salvamento automático. */
  protected touch() {
    this.dirty.set(true);
    this.rev.update((n) => n + 1);
  }

  protected when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  protected setTab(tab: EditorTab) {
    this.router.navigate([], { relativeTo: this.route, queryParams: { aba: tab }, replaceUrl: true });
  }

  protected change(def: AppDefinition) {
    this.def.set(def);
    this.touch();
  }

  protected save() {
    return this.run(() => this.persist(), 'Rascunho salvo.');
  }

  /** Grava o rascunho. Se houve edição durante a ida ao servidor, ela fica na tela e continua pendente. */
  private async persist() {
    const rev = this.rev();
    const saved = await this.api.updateApp(this.id(), {
      name: this.name(), description: this.description(), draft: this.def(), inCatalog: this.inCatalog(),
      isTemplate: this.isTemplate(), allowedDepartments: this.departments().split(',').map((d) => d.trim()).filter(Boolean),
    });
    if (rev === this.rev()) this.setApp(saved);
    else this.app.set(saved);
  }

  /** Salvamento automático: sem banner e sem travar os botões; erro (ex.: regra inválida) fica no selo até a próxima edição. */
  private async autosave() {
    if (!this.dirty() || this.busy() || this.saving()) return;
    this.saving.set(true);
    try {
      await this.persist();
      this.autoError.set(null);
    } catch (e) {
      this.autoError.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
    // Editou enquanto salvava: agenda de novo.
    if (this.dirty() && !this.autoError()) this.rev.update((n) => n + 1);
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
    this.app.set(a);
    this.def.set(a.draft);
    this.name.set(a.name);
    this.description.set(a.description);
    this.inCatalog.set(a.inCatalog);
    this.isTemplate.set(a.isTemplate);
    this.departments.set(a.allowedDepartments.join(', '));
    this.dirty.set(false);
    this.autoError.set(null);
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
