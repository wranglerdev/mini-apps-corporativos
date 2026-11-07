import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UI } from '../ui/ui';

// ============================================================================================
// PRIMITIVAS DE LAYOUT (estrutura das telas). Não são design system: definem ONDE as coisas ficam
// (cabeçalho, seções, larguras, espaçamentos) e desenham com os componentes de ui/. Ao trocar o design
// system, estas continuam. Toda tela deve ser: <app-page> → <app-page-header> (ou <app-toolbar> em telas tool) → <app-section>...
// Estilos em styles.css (seção "Layout").
// ============================================================================================

export type Notice = { text: string; error: boolean } | null;

/** Contêiner de tela: largura, ritmo vertical e o aviso (sucesso/erro) sempre logo abaixo do cabeçalho. */
@Component({
  selector: 'app-page',
  imports: [UI],
  template: `
    <div class="page" [class]="'page page--' + width()">
      <ng-content select="app-page-header, app-toolbar" />
      @if (notice(); as n) {
        <ui-notice [error]="n.error">{{ n.text }}</ui-notice>
      }
      <ng-content />
    </div>
  `,
})
export class Page {
  /**
   * default (leitura, 1120px) | wide (app em execução) | narrow (formulários, 760px) |
   * tool (editor estilo Figma: ocupa a tela inteira, cabeçalho vira barra de ferramentas) |
   * stage (respondente de formulário: coluna central, conteúdo centralizado na altura, sem moldura nem cabeçalho)
   */
  readonly width = input<'default' | 'wide' | 'narrow' | 'tool' | 'stage'>('default');
  readonly notice = input<Notice>(null);
}

/** Cabeçalho único de tela: migalha opcional, título, metadados (chips) e ações à direita. */
@Component({
  selector: 'app-page-header',
  imports: [RouterLink],
  template: `
    <header class="page-header">
      @if (crumb(); as c) {
        <a class="page-header__crumb" [routerLink]="c.link">{{ c.label }}</a>
      }
      <div class="page-header__row">
        <div class="page-header__text">
          <div class="page-header__title">
            <h1>{{ title() }}</h1>
            <ng-content select="[meta]" />
          </div>
          @if (subtitle()) {
            <p class="page-header__subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="page-header__actions"><ng-content select="[actions]" /></div>
      </div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly crumb = input<{ label: string; link: string | unknown[] } | null>(null);
}

/**
 * Cabeçalho das telas `tool` (editor, estilo Figma): uma linha com voltar, [heading] (título, pode ser editável),
 * [meta], [nav] no centro e [actions] à direita. Use no lugar de app-page-header.
 */
@Component({
  selector: 'app-toolbar',
  imports: [RouterLink, UI],
  template: `
    <header class="toolbar">
      <div class="toolbar__start">
        <a class="toolbar__back" [routerLink]="back().link" [attr.title]="'Voltar para ' + back().label" [attr.aria-label]="'Voltar para ' + back().label">
          <ui-icon name="back" />
        </a>
        <ng-content select="[heading]" />
        <ng-content select="[meta]" />
      </div>
      <nav class="toolbar__nav"><ng-content select="[nav]" /></nav>
      <div class="toolbar__end"><ng-content select="[actions]" /></div>
    </header>
  `,
})
export class Toolbar {
  readonly back = input.required<{ label: string; link: string | unknown[] }>();
}

/**
 * Seção de conteúdo. card: cabeçalho fora, conteúdo num cartão. plain: sem cartão.
 * aside: título/descrição numa coluna à esquerda e o cartão à direita (telas de configuração).
 */
@Component({
  selector: 'app-section',
  imports: [UI],
  template: `
    <section class="section" [class.section--aside]="layout() === 'aside'">
      @if (title()) {
        <div class="section__head">
          <div>
            <h2 class="section__title">{{ title() }}</h2>
            @if (description()) {
              <p class="section__description">{{ description() }}</p>
            }
          </div>
          <div class="section__actions"><ng-content select="[actions]" /></div>
        </div>
      }
      <ui-card [plain]="layout() === 'plain'"><ng-content /></ui-card>
    </section>
  `,
})
export class Section {
  readonly title = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly layout = input<'card' | 'plain' | 'aside'>('card');
}

/** Estado vazio: o que falta e (opcional) a ação que resolve. */
@Component({
  selector: 'app-empty',
  template: `
    <div class="empty">
      <p class="empty__title">{{ title() }}</p>
      @if (text()) {
        <p class="empty__text">{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class Empty {
  readonly title = input.required<string>();
  readonly text = input<string | null>(null);
}

/** Importe `LAYOUT` (junto com `UI`) nas telas. */
export const LAYOUT = [Page, PageHeader, Toolbar, Section, Empty] as const;
