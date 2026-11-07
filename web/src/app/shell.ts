import { Injectable, signal } from '@angular/core';
import { canBuild, isAdmin } from './core/auth/auth';
import { CurrentUser } from './core/models';

// Regras puras da moldura (barra lateral e tema), testadas em shell.spec.ts.

export interface NavItem {
  label: string;
  link: string;
  icon: string;
  /** Contador ao lado do rótulo (ex.: aprovações esperando o usuário). */
  badge: number | null;
  exact: boolean;
}

/** O que o usuário pode fazer, conforme o papel (espelha os guards das rotas). */
export function navItems(user: CurrentUser | null, pendingApprovals: number): NavItem[] {
  const item = (label: string, link: string, icon: string, badge: number | null = null): NavItem =>
    ({ label, link, icon, badge, exact: link === '/' });
  const list = [
    item('Início', '/', 'home'),
    item('Catálogo', '/catalog', 'catalog'),
    item('Aprovações', '/approvals', 'approvals', pendingApprovals || null),
  ];
  if (canBuild(user)) list.push(item('Meus apps', '/builder', 'projects'));
  if (isAdmin(user)) list.push(item('Governança', '/admin', 'admin'));
  return list;
}

/** No editor de um app a barra lateral recolhe para dar espaço ao canvas (estilo Figma). */
export const isToolRoute = (url: string) => /^\/builder\/[^/?#]+/.test(url);

/** Respondente de formulário: tela inteira, sem a barra lateral (pode ser link público). */
export const isBareRoute = (url: string) => /^\/f(-preview)?\//.test(url);

export type Theme = 'system' | 'light' | 'dark';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
export const nextTheme = (t: Theme): Theme => NEXT[t];
export const THEME_LABEL: Record<Theme, string> = { system: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro' };
export const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };

/** Tema escolhido pelo usuário. "system" segue o sistema operacional (prefers-color-scheme). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(read());

  cycle() {
    const t = nextTheme(this.theme());
    this.theme.set(t);
    if (t === 'system') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = t;
    try {
      if (t === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', t);
    } catch { /* armazenamento bloqueado: vale só nesta visita */ }
  }
}

function read(): Theme {
  const t = document.documentElement.dataset['theme'];
  return t === 'light' || t === 'dark' ? t : 'system';
}
