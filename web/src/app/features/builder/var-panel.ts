import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { VariableDef } from '../../core/models';
import { Box, placeBeside } from '../../ui/placement';
import { UI } from '../../ui/ui';
import { VARIABLE_TYPES, VarItem } from './variable-ops';

/**
 * Painel de variáveis (workflows, automações, design e formulários): variáveis declaradas (se `variables` vier) e o que
 * existe no ponto, em chips arrastáveis (soltam {{nome}} no campo) com tooltip. Fica dentro de um <aside class="panel">.
 */
@Component({
  selector: 'app-var-panel',
  imports: [UI],
  host: { style: 'display: contents' },
  template: `
    @if (variables(); as list) {
      <div class="panel__section">
        <div class="panel__head">
          <h4>Variáveis</h4>
          <button uiButton variant="ghost" class="icon-btn" aria-label="Nova variável" title="Nova variável" (click)="create.emit()"><ui-icon name="plus" /></button>
        </div>
        @for (v of list; track $index) {
          <button type="button" class="tree-item" [class.active]="selected() === v.name" (click)="select.emit(v.name)">
            <span class="tree-item__text mono">{{ v.name }}</span><span class="var-type">{{ typeLabel(v) }}</span>
          </button>
        } @empty {
          <p class="panel__hint">Guarde valores para usar como {{ example }}: a resposta de uma API, um campo tratado, um total.</p>
          <button uiButton (click)="create.emit()"><ui-icon name="plus" /> Nova variável</button>
        }
      </div>
    }
    <div class="panel__section panel__section--grow">
      <h4>{{ title() }}</h4>
      <p class="panel__hint">Arraste para um campo ou digite {{ open }} no campo.</p>
      @for (g of groups(); track g.group) {
        <span class="panel__group">{{ g.group }}</span>
        @for (v of g.items; track v.value) {
          <code class="var-chip" draggable="true" tabindex="0" [attr.aria-describedby]="tip()?.item === v ? tipId : null"
            (mouseenter)="showTip($event, v)" (focus)="showTip($event, v)" (mouseleave)="tip.set(null)" (blur)="tip.set(null)"
            (dragstart)="drag($event, v)">{{ v.value }}</code>
        }
      } @empty {
        <p class="panel__hint">{{ emptyText() }}</p>
      }
    </div>
    @if (tip(); as t) {
      <div #tipEl [id]="tipId" class="var-tip" role="tooltip">
        <code>{{ open }}{{ t.item.value }}{{ close }}</code>
        @if (t.item.about) { <p>{{ t.item.about }}</p> }
        @if (t.item.empty) { <p><span>Vazia:</span> {{ t.item.empty }}</p> }
        @if (lastValue(); as fn) { <p><span>No último teste:</span> {{ t.value ?? 'rode o teste para ver' }}</p> }
      </div>
    }
  `,
})
export class VarPanel {
  /** Variáveis declaradas; null = sem a seção (ex.: design e formulários só usam o contexto). */
  readonly variables = input<VariableDef[] | null>(null);
  readonly items = input.required<VarItem[]>();
  readonly selected = input<string | null>(null);
  readonly title = input('Disponível neste ponto');
  readonly emptyText = input('Nada disponível aqui ainda.');
  /** Valor no último teste (só onde há teste). */
  readonly lastValue = input<((path: string) => string | null) | null>(null);
  readonly select = output<string>();
  readonly create = output<void>();

  protected readonly open = '{{';
  protected readonly close = '}}';
  protected readonly example = '{{nome}}';
  protected readonly tipId = `var-tip-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly groups = computed(() => {
    const groups = new Map<string, VarItem[]>();
    for (const v of this.items().filter((x) => !x.derived)) groups.set(v.group, [...(groups.get(v.group) ?? []), v]);
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  });
  /** Tooltip em posição fixa (o painel tem rolagem); medido depois de renderizar para caber inteiro na tela. */
  protected readonly tip = signal<{ item: VarItem; anchor: Box; value: string | null } | null>(null);
  private readonly tipEl = viewChild<ElementRef<HTMLElement>>('tipEl');

  constructor() {
    afterRenderEffect({
      write: () => {
        const t = this.tip();
        const el = this.tipEl()?.nativeElement;
        if (!t || !el) return;
        const p = placeBeside(t.anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      },
    });
    // Rolar qualquer coisa (o painel não propaga scroll) esconde o tooltip, que ficaria longe do chip.
    const hide = () => this.tip.set(null);
    document.addEventListener('scroll', hide, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', hide, true));
  }

  protected typeLabel = (v: VariableDef) => (v.from ? 'apelido' : (VARIABLE_TYPES[v.type]?.label ?? v.type));

  protected showTip(e: Event, item: VarItem) {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const fn = this.lastValue();
    const value = fn && item.group !== 'Segredos' ? fn(item.value) : null;
    this.tip.set({ item, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, value });
  }

  protected drag(e: DragEvent, v: VarItem) {
    this.tip.set(null);
    e.dataTransfer?.setData('text/plain', `{{${v.value}}}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
}
