import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { PageDef } from '../../core/models';
import { pageInputs } from '../builder/variable-ops';
import { prefillFrom } from './links';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';
import { RenderedComponent } from './rendered-component';
import { RunContext } from './run-context';

/**
 * Modo usuário. /run/:slug → versão publicada (produção). /preview/:id → rascunho (só builders).
 * Página atual via ?page=ID. Não exibe nada do editor.
 */
@Component({
  selector: 'app-runner',
  imports: [UI, LAYOUT, RenderedComponent, RouterLink],
  providers: [RunContext],
  template: `
    @if (error()) {
      <app-page>
        <app-page-header title="Não foi possível abrir o app" [crumb]="{ label: 'Biblioteca', link: '/biblioteca' }" />
        <ui-notice [error]="true">{{ error() }}</ui-notice>
      </app-page>
    } @else if (ctx.definition(); as def) {
      <app-page width="wide" [notice]="ctx.notice()">
        <app-page-header [title]="title()" [crumb]="crumb()">
          <ng-container ngProjectAs="[meta]">
            @if (ctx.env() === 'draft') {
              <ui-stamp tone="wait">Rascunho</ui-stamp>
            } @else {
              <span class="chip">versão {{ version() }}</span>
            }
          </ng-container>
          <button actions uiButton variant="ghost" class="no-print" (click)="print()">Imprimir página</button>
        </app-page-header>

        @if (def.pages.length > 1) {
          <nav class="tabs no-print">
            @for (p of def.pages; track p.id) {
              <a [class.active]="p.id === currentPage()?.id" [routerLink]="[]" [queryParams]="{ page: p.id }">{{ p.name }}</a>
            }
          </nav>
        }

        <div class="grid">
          @for (c of currentPage()?.components; track c.id) {
            @if (ctx.isVisible(c)) {
              <div class="cell" [style.--span]="c.span"><app-rendered [component]="c" /></div>
            }
          }
        </div>
      </app-page>
    }
  `,
})
export class AppRunner {
  readonly slug = input<string>();
  readonly id = input<string>();
  readonly page = input<string>();

  protected readonly ctx = inject(RunContext);
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  protected readonly title = signal('');
  protected readonly version = signal<number | null>(null);
  protected readonly error = signal('');
  /** Produção volta à Biblioteca; rascunho volta ao editor. */
  protected readonly crumb = computed(() =>
    this.ctx.env() === 'draft' ? { label: 'Editor', link: ['/builder', this.ctx.appId()] } : { label: 'Biblioteca', link: '/biblioteca' });

  protected readonly currentPage = computed<PageDef | undefined>(() => {
    const pages = this.ctx.definition()?.pages ?? [];
    return pages.find((p) => p.id === this.page()) ?? pages[0];
  });

  constructor() {
    effect(() => {
      const slug = this.slug();
      const id = this.id();
      untracked(() => this.load(slug, id));
    });
  }

  private async load(slug?: string, id?: string) {
    try {
      if (slug) {
        const v = await this.api.run(slug);
        this.title.set(v.name);
        this.version.set(v.version);
        this.ctx.appId.set(v.appId);
        this.ctx.env.set('prod');
        this.ctx.canManage.set(v.canManage);
        this.ctx.definition.set(v.definition);
      } else if (id) {
        const a = await this.api.app(id);
        this.title.set(a.name);
        this.ctx.appId.set(a.id);
        this.ctx.env.set('draft');
        this.ctx.canManage.set(true);
        this.ctx.definition.set(a.draft);
      }
      // Valores que vieram na URL (ação "Abrir projeto ou link" de outro projeto) preenchem os inputs com o mesmo nome.
      const def = this.ctx.definition();
      if (def) this.ctx.inputs.set(prefillFrom(this.route.snapshot.queryParams, pageInputs(def).map((i) => i.name)));
    } catch (e) {
      this.error.set((e as { error?: { title?: string } })?.error?.title ?? 'Não foi possível abrir o app.');
    }
  }

  protected print() {
    window.print();
  }
}
