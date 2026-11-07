import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from './core/api';
import { AuthService } from './core/auth/auth';
import { THEME_ICON, THEME_LABEL, ThemeService, isBareRoute, isToolRoute, navItems } from './shell';
import { UI } from './ui/ui';

export const PRODUCT_NAME = 'Mini apps';

const ROLE_LABEL = { admin: 'Administrador', builder: 'Builder', user: 'Usuário' } as const;

/** Moldura: barra lateral (estilo Linear) que recolhe no editor; no celular vira barra no topo. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UI],
  template: `
    <div class="shell" [class.shell--tool]="tool()" [class.shell--bare]="bare()">
      <aside class="rail" [hidden]="bare()">
        <a routerLink="/" class="rail__brand" [attr.title]="productName">
          <span class="rail__logo" aria-hidden="true"></span>
          <span class="rail__label">{{ productName }}</span>
        </a>
        <nav class="rail__nav">
          @for (n of nav(); track n.link) {
            <a class="rail__link" [routerLink]="n.link" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: n.exact }" [attr.title]="n.label">
              <ui-icon [name]="n.icon" />
              <span class="rail__label">{{ n.label }}</span>
              @if (n.badge) { <span class="rail__badge">{{ n.badge }}</span> }
            </a>
          }
        </nav>
        <div class="rail__foot">
          @if (user(); as u) {
            <div class="rail__user" [attr.title]="u.name + ' · ' + roleLabel[u.role] + ' em ' + u.department">
              <span class="rail__avatar" aria-hidden="true">{{ u.name.charAt(0) }}</span>
              <span class="rail__label">
                <strong>{{ u.name }}</strong>
                <span>{{ roleLabel[u.role] }} em {{ u.department }}</span>
              </span>
            </div>
          }
          <button uiButton variant="ghost" class="rail__theme" [attr.title]="themeLabel[theme.theme()]" [attr.aria-label]="themeLabel[theme.theme()]" (click)="theme.cycle()">
            <ui-icon [name]="themeIcon[theme.theme()]" />
          </button>
        </div>
      </aside>
      <main class="content"><router-outlet /></main>
    </div>
  `,
})
export class App {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly productName = PRODUCT_NAME;
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly themeLabel = THEME_LABEL;
  protected readonly themeIcon = THEME_ICON;
  protected readonly user = inject(AuthService).user;
  private readonly url = signal(this.router.url);
  private readonly pending = signal(0);
  protected readonly tool = computed(() => isToolRoute(this.url()));
  protected readonly bare = computed(() => isBareRoute(this.url()));
  protected readonly nav = computed(() => navItems(this.user(), this.pending()));

  constructor() {
    // A cada navegação: atualiza a rota (recolher no editor) e o contador de aprovações.
    this.router.events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      this.url.set(e.urlAfterRedirects);
      if (isBareRoute(e.urlAfterRedirects)) return; // respondente pode estar sem login
      this.api.approvals().then(
        (list) => this.pending.set(list.filter((a) => a.status === 'pending' && a.approver === this.user()?.email).length),
        () => this.pending.set(0),
      );
    });
  }
}
