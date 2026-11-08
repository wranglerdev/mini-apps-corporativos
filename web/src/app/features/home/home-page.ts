import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthService, canBuild } from '../../core/auth/auth';
import { AppSummary, Workspace } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { Box } from '../../ui/placement';
import { NEW_NAME, PROJECT_KINDS, ProjectKind, ProjectKindOption, kindOf, projectMenu, recentProjects, runLink, sketchBlocks } from './home';

const KIND_LABEL: Record<ProjectKind, string> = { app: 'Mini app', form: 'Formulário', workflow: 'Workflow' };

/**
 * Início (referência: navegador de arquivos do Figma): criar no topo, projetos recentes em grade com miniatura
 * e filtro por tipo. Os atalhos (biblioteca, aprovações...) ficam na barra lateral.
 */
@Component({
  selector: 'app-home-page',
  imports: [UI, LAYOUT, RouterLink],
  template: `
    <app-page [notice]="notice()">
      <app-page-header [title]="greeting()" [subtitle]="builder() ? 'Crie algo novo ou continue de onde parou.' : 'Os apps que as áreas publicaram para você.'">
        @if (builder() && workspaces().length > 1) {
          <div actions class="home-ws">
            <ui-select label="Criar em" [options]="wsOptions()" [(value)]="workspaceId" />
          </div>
        }
      </app-page-header>

      @if (builder()) {
        <app-section layout="plain" title="Criar">
          <div class="create-grid">
            @for (k of kinds; track k.kind) {
              <button type="button" class="create-card" [class.create-card--soon]="!k.ready" [disabled]="!k.ready || busy() || !workspaceId()" (click)="create(k)">
                <span class="create-card__icon" [attr.data-kind]="k.kind"><ui-icon [name]="k.icon" /></span>
                <span class="create-card__text">
                  <strong>{{ k.label }} @if (!k.ready) { <span class="chip">Em breve</span> }</strong>
                  <span>{{ k.text }}</span>
                </span>
                @if (k.ready) { <ui-icon class="create-card__plus" name="plus" /> }
              </button>
            }
          </div>
        </app-section>
      }

      <app-section layout="plain" [title]="builder() ? 'Recentes' : 'Apps para você'">
        <div actions class="row">
          @if (builder()) {
            <ui-segmented label="Tipo" [options]="filters" [(value)]="filter" />
          } @else {
            <a uiButton variant="ghost" routerLink="/biblioteca">Ver biblioteca</a>
          }
        </div>
        <div class="project-grid">
          @for (p of projects(); track p.id) {
            <div class="project-card-wrap">
            <a class="project-card" [routerLink]="link(p)" (contextmenu)="openMenu($event, p)">
              <div class="thumb">
                @let blocks = sketch(p);
                @if (blocks.length) {
                  <div class="thumb__page">
                    @for (b of blocks; track $index) {
                      <span class="thumb__b" [attr.data-type]="b.type" [style.--span]="b.span"></span>
                    }
                  </div>
                } @else {
                  <span class="thumb__empty"><ui-icon [name]="kindOf(p)" /></span>
                }
              </div>
              <div class="project-card__body">
                <strong class="project-card__name">{{ p.name }}</strong>
                <span class="project-card__meta">
                  {{ kindLabel[kindOf(p)] }} ·
                  @if (p.publishedVersion) { versão {{ p.publishedVersion }} } @else { rascunho }
                  · {{ ago(p.updatedAt) }}
                </span>
              </div>
            </a>
            @if (builder()) {
              <button type="button" class="project-card__more" [class.open]="menu()?.project === p" aria-haspopup="menu"
                [attr.aria-expanded]="menu()?.project === p" [attr.aria-label]="'Mais ações de ' + p.name" (click)="openMenu($event, p)">
                <ui-icon name="more" />
              </button>
            }
            </div>
          } @empty {
            <app-empty [title]="emptyTitle()" [text]="emptyText()" />
          }
        </div>
        <ui-menu [anchor]="menu()?.anchor ?? null" [items]="menuItems()" [label]="'Ações de ' + (menu()?.project?.name ?? '')"
          (select)="onMenu($event)" (close)="menu.set(null)" />
      </app-section>
    </app-page>
  `,
})
export class HomePage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly user = inject(AuthService).user;

  protected readonly kinds = PROJECT_KINDS;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly kindOf = kindOf;
  protected readonly filters = [
    { value: '', label: 'Todos' }, { value: 'app', label: 'Mini apps' }, { value: 'form', label: 'Formulários' }, { value: 'workflow', label: 'Workflows' },
  ];
  protected readonly builder = computed(() => canBuild(this.user()));
  protected readonly greeting = computed(() => `Olá, ${this.user()?.name.split(' ')[0] ?? ''}`);

  private readonly mine = signal<AppSummary[]>([]);
  private readonly catalog = signal<AppSummary[]>([]);
  protected readonly workspaces = signal<Workspace[]>([]);
  protected readonly workspaceId = signal('');
  protected readonly filter = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<Notice>(null);

  protected readonly wsOptions = computed(() => this.workspaces().map((w) => ({ value: w.id, label: w.name })));
  protected readonly projects = computed(() =>
    this.builder() ? recentProjects(this.mine(), this.filter() as ProjectKind | '', 12) : recentProjects(this.catalog(), '', 12));
  protected readonly emptyTitle = computed(() => {
    if (!this.builder()) return 'Nenhum app liberado para você ainda';
    const f = this.filter();
    return 'Nenhum projeto ainda';
  });
  protected readonly emptyText = computed(() =>
    !this.builder() ? 'Quando uma área publicar um app para o seu departamento, ele aparece aqui.'
      : this.filter() ? 'Nenhum projeto deste tipo ainda.'
        : 'Crie o primeiro acima ou use um template da Biblioteca.');
  /** Card com o menu aberto (botão ⋯ ou botão direito) e se já pediu para excluir. */
  protected readonly menu = signal<{ project: AppSummary; anchor: Box; confirm: boolean } | null>(null);
  protected readonly menuItems = computed(() => {
    const m = this.menu();
    return m ? projectMenu(m.project, m.confirm) : [];
  });

  constructor() {
    this.attempt(async () => {
      if (this.builder()) {
        const [apps, workspaces] = await Promise.all([this.api.apps(), this.api.workspaces()]);
        this.mine.set(apps);
        this.workspaces.set(workspaces);
        this.workspaceId.set(workspaces[0]?.id ?? '');
      } else {
        this.catalog.set(await this.api.catalog());
      }
    });
  }

  protected sketch(p: AppSummary) {
    return sketchBlocks(p.sketch);
  }

  protected link(p: AppSummary) {
    return this.builder() ? ['/builder', p.id] : runLink(p);
  }

  protected ago(iso: string) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days <= 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`;
  }

  /** Botão direito no card ou botão ⋯: abre o menu no ponto do clique ou embaixo do botão. Só para quem gerencia. */
  protected openMenu(e: MouseEvent, p: AppSummary) {
    if (!this.builder()) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.type === 'contextmenu' ? { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY }
      : (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ project: p, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, confirm: false });
  }

  protected onMenu(action: string) {
    const m = this.menu();
    if (!m) return;
    const p = m.project;
    if (action === 'delete' && !m.confirm) return this.menu.set({ ...m, confirm: true });
    this.menu.set(null);
    switch (action) {
      case 'edit': return this.router.navigate(['/builder', p.id]);
      case 'open': return this.router.navigate(runLink(p));
      case 'duplicate':
        return this.attempt(async () => {
          await this.api.duplicate(p.id, p.workspaceId);
          await this.reload();
          this.notice.set({ text: `Cópia de "${p.name}" criada.`, error: false });
        });
      case 'delete':
        return this.attempt(async () => {
          await this.api.deleteApp(p.id);
          await this.reload();
          this.notice.set({ text: `"${p.name}" excluído.`, error: false });
        });
    }
    return;
  }

  private async reload() {
    this.mine.set(await this.api.apps());
  }

  /** Como no Figma: cria "sem título" e abre o editor; o nome se ajusta lá. */
  protected create(k: ProjectKindOption) {
    if (!k.ready || k.kind === 'catalog') return;
    const kind = k.kind;
    return this.attempt(async () => {
      const app = await this.api.createApp(this.workspaceId(), NEW_NAME[kind], null, kind);
      this.router.navigate(['/builder', app.id]);
    });
  }

  private async attempt(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
