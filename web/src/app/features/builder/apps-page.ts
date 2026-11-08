import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AppSummary, Workspace } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { runLink } from '../home/home';

/** Home do builder: apps dos workspaces que gerencio, criação (em branco ou de template) e biblioteca. */
@Component({
  selector: 'app-apps-page',
  imports: [UI, LAYOUT, RouterLink],
  template: `
    <app-page [notice]="notice()">
      <app-page-header title="Meus apps" subtitle="Apps dos workspaces que você gerencia. Comece em branco ou a partir de um template." />

      <div class="columns">
        <app-section [title]="apps().length + (apps().length === 1 ? ' app' : ' apps')">
          <div class="index">
            @for (a of apps(); track a.id) {
              <div class="index__row">
                <div>
                  <a class="index__name" [routerLink]="['/builder', a.id]">{{ a.name }}</a>
                  <div class="index__meta">
                    <span class="chip">{{ kindLabel[a.kind] }}</span>
                    <span class="chip">{{ wsName(a.workspaceId) }}</span>
                    @if (a.publishedVersion) {
                      <span class="chip chip--pen">Publicado, versão {{ a.publishedVersion }}</span>
                    } @else {
                      <span class="chip">Rascunho</span>
                    }
                    @if (a.inCatalog) { <span class="chip">Na biblioteca</span> }
                    @if (a.isTemplate) { <span class="chip">Template</span> }
                  </div>
                </div>
                <div class="index__actions">
                  @if (a.publishedVersion && a.kind !== 'workflow') {
                    <a uiButton variant="ghost" [routerLink]="link(a)">Abrir</a>
                  }
                  <button uiButton variant="ghost" (click)="duplicate(a)">Duplicar</button>
                  <button uiButton variant="danger" (click)="remove(a)">{{ confirm() === a.id ? 'Confirmar exclusão' : 'Excluir' }}</button>
                  <a uiButton [routerLink]="['/builder', a.id]">Editar</a>
                </div>
              </div>
            } @empty {
              <app-empty title="Você ainda não tem apps" text="Crie o primeiro ao lado ou comece por um template da Biblioteca." />
            }
          </div>
        </app-section>

        <app-section title="Novo app">
          <ui-input label="Nome" placeholder="Ex.: Pedidos de compra" [(value)]="name" />
          @if (workspaces().length > 1) {
            <ui-select label="Workspace" [options]="wsOptions()" [(value)]="workspaceId" />
          }
          <ui-select label="Começar de" placeholder="Em branco" [options]="templateOptions()" [(value)]="templateId" />
          <button uiButton variant="primary" [disabled]="!name() || !workspaceId()" (click)="create()">Criar app</button>
        </app-section>
      </div>

    </app-page>
  `,
})
export class AppsPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly apps = signal<AppSummary[]>([]);
  protected readonly templates = signal<AppSummary[]>([]);
  protected readonly workspaces = signal<Workspace[]>([]);
  protected readonly name = signal('');
  protected readonly workspaceId = signal('');
  protected readonly templateId = signal('');
  protected readonly confirm = signal<string | null>(null);
  protected readonly notice = signal<{ text: string; error: boolean } | null>(null);

  protected readonly wsOptions = computed(() => this.workspaces().map((w) => ({ value: w.id, label: w.name })));
  protected readonly templateOptions = computed(() => this.templates().map((t) => ({ value: t.id, label: t.name })));

  constructor() {
    this.refresh();
  }

  protected link = runLink;
  protected readonly kindLabel: Record<string, string> = { app: 'Mini app', form: 'Formulário', workflow: 'Workflow' };
  protected wsName = (id: string) => this.workspaces().find((w) => w.id === id)?.name ?? '';

  protected create() {
    return this.run(async () => {
      const app = await this.api.createApp(this.workspaceId(), this.name(), this.templateId() || null);
      this.router.navigate(['/builder', app.id]);
    });
  }

  protected duplicate(a: AppSummary) {
    return this.run(async () => {
      await this.api.duplicate(a.id, a.workspaceId);
      await this.refresh();
    }, `Cópia de "${a.name}" criada.`);
  }

  protected remove(a: AppSummary) {
    if (this.confirm() !== a.id) return this.confirm.set(a.id);
    return this.run(async () => {
      await this.api.deleteApp(a.id);
      await this.refresh();
    }, `"${a.name}" excluído.`);
  }

  private async refresh() {
    await this.run(async () => {
      const [apps, templates, workspaces] = await Promise.all([this.api.apps(), this.api.templates(), this.api.workspaces()]);
      this.apps.set(apps);
      this.templates.set(templates);
      this.workspaces.set(workspaces);
      if (!this.workspaceId() && workspaces.length) this.workspaceId.set(workspaces[0].id);
    });
  }

  private async run(fn: () => Promise<void>, success?: string) {
    try {
      await fn();
      if (success) this.notice.set({ text: success, error: false });
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    }
  }
}
