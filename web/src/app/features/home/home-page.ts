import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthService, canBuild } from '../../core/auth/auth';
import { AppSummary, Workspace } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { NEW_NAME, PROJECT_KINDS, ProjectKind, ProjectKindOption, kindOf, recentProjects, runLink, sketchBlocks } from './home';

const KIND_LABEL: Record<ProjectKind, string> = { app: 'Mini app', form: 'Formulário', workflow: 'Workflow' };

/**
 * Início (referência: navegador de arquivos do Figma): criar no topo, projetos recentes em grade com miniatura
 * e filtro por tipo. Os atalhos (catálogo, aprovações...) ficam na barra lateral.
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
            <a uiButton variant="ghost" routerLink="/catalog">Ver catálogo</a>
          }
        </div>
        <div class="project-grid">
          @for (p of projects(); track p.id) {
            <a class="project-card" [routerLink]="link(p)">
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
          } @empty {
            <app-empty [title]="emptyTitle()" [text]="emptyText()" />
          }
        </div>
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
        : 'Crie o primeiro acima ou use um template em Meus apps.');

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

  /** Como no Figma: cria "sem título" e abre o editor; o nome se ajusta lá. */
  protected create(k: ProjectKindOption) {
    if (!k.ready) return;
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
