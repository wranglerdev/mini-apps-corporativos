import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, model, signal } from '@angular/core';
import { AppDefinition, ComponentDef, ComponentType, ConditionDef, ConditionOp, PageDef } from '../../core/models';
import { UI } from '../../ui/ui';
import { RenderedComponent } from '../runtime/rendered-component';
import { CONDITION_OPS, USER_VARIABLES } from '../runtime/visibility';
import {
  COMPONENTS, PALETTE_GROUPS, addPage, duplicateComponent, findComponent, flatten, insertComponent, moveComponent,
  nudgeComponent, outline, pathTo, removeComponent, removePage, summary,
} from './editor-ops';
import { PropControl } from './prop-control';

type Drag = { kind: 'new'; type: ComponentType } | { kind: 'move'; id: string };
type DropTarget = { parent: string | null; index: number };

const SPANS = [
  { value: '3', label: '1/4' }, { value: '4', label: '1/3' }, { value: '5', label: '5/12' }, { value: '6', label: '1/2' },
  { value: '7', label: '7/12' }, { value: '8', label: '2/3' }, { value: '9', label: '3/4' }, { value: '12', label: 'Inteira' },
].map((s) => ({ ...s, title: `${s.value} de 12 colunas` }));

/**
 * Editor visual: páginas, estrutura (árvore), paleta, folha com prévias realistas, containers aninhados, indicador de
 * soltura, barra de ações no item selecionado, prévia de celular e painel de propriedades.
 * Atalhos: Delete remove, Ctrl+D duplica, Alt+↑/↓ move, Esc tira a seleção.
 */
@Component({
  selector: 'app-design-tab',
  imports: [UI, RenderedComponent, PropControl, NgTemplateOutlet],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @let d = def();
    <div class="editor">
      <aside class="panel panel--left">
        <div class="panel__section">
          <div class="panel__head">
            <h4>Páginas</h4>
            <button uiButton variant="ghost" class="icon-btn" title="Adicionar página" aria-label="Adicionar página" (click)="newPage()"><ui-icon name="plus" /></button>
          </div>
          @for (p of d.pages; track p.id) {
            <button type="button" class="tree-item" [class.active]="p.id === page()?.id" (click)="selectPage(p.id)">
              <ui-icon name="text" class="tree-item__icon" /><span class="tree-item__text">{{ p.name }}</span>
            </button>
          }
        </div>

        <div class="panel__section panel__section--grow">
          <ui-segmented label="Painel" [columns]="2" [options]="leftTabs" [(value)]="leftTab" />
          @if (leftTab() === 'insert') {
            <p class="panel__hint">Arraste para a página ou clique para inserir {{ insertHint() }}.</p>
            @for (g of groups; track g.label) {
              <h5 class="panel__group">{{ g.label }}</h5>
              @for (t of g.types; track t) {
                <div class="palette-item" draggable="true" (dragstart)="start($event, { kind: 'new', type: t })" (dragend)="endDrag()" (click)="add(t)">
                  <span class="palette-item__icon"><ui-icon [name]="t" /></span>
                  <span>{{ specs[t].label }}</span>
                </div>
              }
            }
          } @else {
            <div class="tree">
              @for (row of tree(); track row.component.id) {
                <button type="button" class="tree-item" [class.active]="row.component.id === selectedId()"
                  [style.padding-left.px]="8 + row.depth * 14" (click)="selectedId.set(row.component.id)">
                  <ui-icon class="tree-item__icon" [name]="row.component.type" />
                  <span class="tree-item__text">{{ summaryOf(row.component) || labelOf(row.component) }}</span>
                  @if (row.component.visibleWhen?.field) {
                    <span class="tree-item__flag" title="Visível só sob condição">se</span>
                  }
                </button>
              } @empty {
                <p class="panel__hint">Página vazia.</p>
              }
            </div>
          }
        </div>
      </aside>

      <section class="canvas" (click)="selectedId.set(null)">
        <div class="canvas__bar" (click)="$event.stopPropagation()">
          <ui-segmented label="Dispositivo" [options]="devices" [(value)]="device" />
        </div>
        <div class="frame" [class.frame--mobile]="device() === 'mobile'">
          <span class="frame__label">{{ page()?.name }}</span>
          <div class="sheet" [class.sheet--mobile]="device() === 'mobile'" [class.is-dragging]="!!drag()">
            <ng-container *ngTemplateOutlet="tree_; context: { $implicit: page()?.components ?? [], parent: null }" />
          </div>
        </div>
        <p class="canvas__hint">Delete remove · Ctrl+D duplica · Alt+↑/↓ move · Esc tira a seleção</p>
      </section>

      <aside class="panel panel--right">
        @if (selected(); as c) {
          <div class="panel__section">
            <nav class="path" aria-label="Caminho do componente">
              <button type="button" (click)="selectedId.set(null)">{{ page()?.name }}</button>
              @for (a of path(); track a.id) {
                <span>›</span>
                <button type="button" [class.current]="a.id === c.id" (click)="selectedId.set(a.id)">{{ labelOf(a) }}</button>
              }
            </nav>
            <div class="panel__title"><ui-icon [name]="c.type" /> {{ specs[c.type].label }}</div>
          </div>
          <div class="panel__section">
            <h4>Layout</h4>
            <div class="prop">
              <span class="prop__label">Largura</span>
              <ui-segmented label="Largura" [columns]="4" [options]="spans" [value]="'' + c.span" (valueChange)="setSpan($event)" />
            </div>
          </div>

          @if (specs[c.type].props.length) {
            <div class="panel__section">
              <h4>Conteúdo</h4>
              @for (s of specs[c.type].props; track s.key) {
                <app-prop-control [spec]="s" [def]="d" [tableId]="c.props['tableId']" [value]="c.props[s.key] ?? ''"
                  (valueChange)="setProp(s.key, $event)" />
              }
            </div>
          }

          <div class="panel__section">
            <h4>Visibilidade</h4>
            <ui-select label="Mostrar quando" placeholder="Sempre" [options]="variables()" [value]="c.visibleWhen?.field ?? ''"
              (valueChange)="setVisibility('field', $event)" />
            @if (c.visibleWhen?.field) {
              <ui-select label="Condição" [options]="ops" [value]="c.visibleWhen?.op ?? 'eq'" (valueChange)="setVisibility('op', $event)" />
              @if (c.visibleWhen?.op !== 'empty' && c.visibleWhen?.op !== 'notEmpty') {
                <ui-input label="Valor" [value]="c.visibleWhen?.value ?? ''" (valueChange)="setVisibility('value', $event)" />
              }
              <p class="panel__hint">Só esconde na tela. Para proteger dados, use as permissões da tabela e dos campos.</p>
            }
          </div>

          <div class="panel__section row">
            <button uiButton (click)="duplicate()">Duplicar</button>
            <button uiButton variant="danger" (click)="remove(c.id)">{{ c.type === 'container' ? 'Remover com conteúdo' : 'Remover' }}</button>
          </div>
        } @else if (page(); as p) {
          <div class="panel__section">
            <div class="panel__title"><ui-icon name="text" /> Página</div>
          </div>
          <div class="panel__section">
            <ui-input label="Nome da página" [value]="p.name" (valueChange)="renamePage($event)" />
            <p class="panel__hint">Clique num componente da página ou em Camadas para editar as propriedades dele.</p>
          </div>
          @if (d.pages.length > 1) {
            <div class="panel__section">
              <button uiButton variant="danger" (click)="deletePage()">Excluir página</button>
            </div>
          }
        }
      </aside>
    </div>

    <!-- Árvore recursiva: a raiz da página e cada container usam o mesmo template -->
    <ng-template #tree_ let-list let-parent="parent">
      <div class="grid" [class.grid--nested]="parent" (dragover)="over($event, parent, list.length)" (drop)="drop($event)">
        @for (c of list; track c.id; let i = $index) {
          @if (isDropAt(parent, i)) {
            <div class="cell drop-ghost" [style.--span]="ghostSpan()" (dragover)="over($event, parent, i)" (drop)="drop($event)">Soltar aqui</div>
          }
          <div class="cell canvas-item" [class.selected]="c.id === selectedId()" [class.is-dragged]="isDragged(c.id)"
            [class.canvas-item--box]="c.type === 'container'" [style.--span]="c.span" draggable="true"
            (dragstart)="start($event, { kind: 'move', id: c.id })" (dragend)="endDrag()"
            (dragover)="overItem($event, parent, i)" (drop)="drop($event)" (click)="select($event, c.id)">
            @if (c.id === selectedId()) {
              <div class="item-toolbar" (click)="$event.stopPropagation()">
                <span class="item-toolbar__label">{{ labelOf(c) }}, {{ c.span }}/12</span>
                <button uiButton variant="ghost" title="Subir (Alt+↑)" aria-label="Subir" (click)="nudge(-1)">↑</button>
                <button uiButton variant="ghost" title="Descer (Alt+↓)" aria-label="Descer" (click)="nudge(1)">↓</button>
                <button uiButton variant="ghost" title="Duplicar (Ctrl+D)" (click)="duplicate()">Duplicar</button>
                <button uiButton variant="ghost" title="Remover (Delete)" (click)="remove(c.id)">Remover</button>
              </div>
            } @else {
              <span class="canvas-item__tag">{{ labelOf(c) }}, {{ c.span }}/12</span>
            }
            @if (c.visibleWhen?.field) {
              <span class="canvas-item__flag" title="Visível só quando a condição for atendida">condicional</span>
            }
            @if (c.type === 'container') {
              <div class="box-design" [class.box-design--plain]="c.props['variant'] === 'plain'">
                @if (c.props['title']) {
                  <strong class="box-design__title">{{ c.props['title'] }}</strong>
                }
                <ng-container *ngTemplateOutlet="tree_; context: { $implicit: c.children ?? [], parent: c.id }" />
              </div>
            } @else {
              <app-rendered [component]="c" [design]="true" [tables]="tables()" />
            }
          </div>
        } @empty {
          @if (!isDropAt(parent, 0)) {
            <p class="canvas-empty">{{ parent ? 'Arraste componentes para dentro deste container.' : 'Página vazia. Arraste um componente da lista à esquerda.' }}</p>
          }
        }
        @if (isDropAt(parent, list.length)) {
          <div class="cell drop-ghost" [style.--span]="ghostSpan()" (dragover)="over($event, parent, list.length)" (drop)="drop($event)">Soltar aqui</div>
        }
      </div>
    </ng-template>
  `,
})
export class DesignTab {
  readonly def = model.required<AppDefinition>();

  protected readonly specs = COMPONENTS;
  protected readonly groups = PALETTE_GROUPS;
  protected readonly leftTabs = [{ value: 'insert', label: 'Inserir' }, { value: 'layers', label: 'Camadas' }];
  protected readonly leftTab = signal('insert');
  protected readonly ops = CONDITION_OPS;
  protected readonly spans = SPANS;
  protected readonly devices = [{ value: 'desktop', label: 'Computador' }, { value: 'mobile', label: 'Celular' }];
  protected readonly device = signal('desktop');
  protected readonly pageId = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly drag = signal<Drag | null>(null);
  protected readonly dropAt = signal<DropTarget | null>(null);

  protected readonly page = computed<PageDef | undefined>(() => {
    const pages = this.def().pages;
    return pages.find((p) => p.id === this.pageId()) ?? pages[0];
  });
  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (findComponent(this.page()?.components ?? [], id)?.component ?? null) : null;
  });
  protected readonly path = computed(() => (this.selectedId() ? pathTo(this.page()?.components ?? [], this.selectedId()!) : []));
  protected readonly tree = computed(() => outline(this.page()?.components ?? []));
  protected readonly tables = computed(() => Object.fromEntries(this.def().tables.map((t) => [t.id, t])));
  private readonly tableNames = computed(() => Object.fromEntries(this.def().tables.map((t) => [t.id, t.name])));
  protected readonly insertHint = computed(() => {
    const s = this.selected();
    return !s ? 'no fim da página' : s.type === 'container' ? 'dentro do container selecionado' : 'logo depois do selecionado';
  });
  protected readonly ghostSpan = computed(() => {
    const drag = this.drag();
    if (!drag) return 12;
    if (drag.kind === 'new') return COMPONENTS[drag.type].span;
    return findComponent(this.page()?.components ?? [], drag.id)?.component.span ?? 12;
  });

  /** Campos de entrada de todas as páginas + variáveis do usuário. */
  protected readonly variables = computed(() => {
    const inputs = this.def().pages.flatMap((p) => flatten(p.components)).filter((c) => c.type === 'input' && c.props['name']);
    const unique = [...new Map(inputs.map((c) => [c.props['name']!, c.props['label'] || c.props['name']!])).entries()];
    return [...unique.map(([name, label]) => ({ value: name, label: `Campo "${label}"` })), ...USER_VARIABLES];
  });

  protected labelOf = (c: ComponentDef) => COMPONENTS[c.type].label;
  protected summaryOf = (c: ComponentDef) => summary(c, this.tableNames());
  protected isDropAt = (parent: string | null, index: number) => {
    const t = this.dropAt();
    return !!t && t.parent === parent && t.index === index;
  };
  protected isDragged = (id: string) => {
    const d = this.drag();
    return d?.kind === 'move' && d.id === id;
  };

  /** Toda alteração passa por aqui: clona, muta e emite a nova definição. */
  protected edit(fn: (d: AppDefinition) => void) {
    const d = structuredClone(this.def());
    fn(d);
    this.def.set(d);
  }

  private pageOf = (d: AppDefinition) => d.pages.find((p) => p.id === this.page()!.id)!;
  private selectedIn = (d: AppDefinition) => findComponent(this.pageOf(d).components, this.selectedId()!)!.component;

  protected selectPage(id: string) {
    this.pageId.set(id);
    this.selectedId.set(null);
  }

  protected select(e: Event, id: string) {
    e.stopPropagation(); // clique no filho não seleciona o container
    this.selectedId.set(id);
  }

  protected newPage() {
    let id = '';
    this.edit((d) => (id = addPage(d).id));
    this.selectPage(id);
  }

  protected deletePage() {
    this.edit((d) => removePage(d, this.page()!.id));
    this.selectPage(this.def().pages[0].id);
  }

  /** Clique na paleta: dentro do container selecionado, logo depois do item selecionado, ou no fim da página. */
  protected add(type: ComponentType) {
    const sel = this.selected();
    if (!sel) return this.insert(type, null, undefined);
    if (sel.type === 'container') return this.insert(type, sel.id, undefined);
    const found = findComponent(this.page()!.components, sel.id)!;
    const parent = this.path().at(-2)?.id ?? null;
    this.insert(type, parent, found.index + 1);
  }

  private insert(type: ComponentType, parentId: string | null, index: number | undefined) {
    this.edit((d) => {
      const c = insertComponent(this.pageOf(d), type, index, parentId);
      if (c) this.selectedId.set(c.id);
    });
  }

  // ---------- arrastar e soltar ----------

  protected start(e: DragEvent, drag: Drag) {
    e.stopPropagation(); // arrastar um filho não arrasta o container
    this.drag.set(drag);
    e.dataTransfer?.setData('text/plain', drag.kind);
  }

  protected endDrag() {
    this.drag.set(null);
    this.dropAt.set(null);
  }

  protected over(e: DragEvent, parent: string | null, index: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!this.isDropAt(parent, index)) this.dropAt.set({ parent, index });
  }

  /** Sobre um item: metade inicial = antes dele; metade final = depois (eixo conforme a largura do item). */
  protected overItem(e: DragEvent, parent: string | null, index: number) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sideBySide = rect.width < (el.parentElement?.clientWidth ?? rect.width) * 0.6;
    const after = sideBySide ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
    this.over(e, parent, after ? index + 1 : index);
  }

  protected drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const drag = this.drag();
    const target = this.dropAt();
    this.endDrag();
    if (!drag || !target) return;
    if (drag.kind === 'new') this.insert(drag.type, target.parent, target.index);
    else this.edit((d) => moveComponent(this.pageOf(d), drag.id, target.parent, target.index));
  }

  // ---------- ações no selecionado ----------

  protected nudge(delta: -1 | 1) {
    if (this.selectedId()) this.edit((d) => nudgeComponent(this.pageOf(d), this.selectedId()!, delta));
  }

  protected duplicate() {
    if (!this.selectedId()) return;
    this.edit((d) => {
      const copy = duplicateComponent(this.pageOf(d), this.selectedId()!);
      if (copy) this.selectedId.set(copy.id);
    });
  }

  protected remove(id: string) {
    this.edit((d) => removeComponent(this.pageOf(d), id));
    this.selectedId.set(null);
  }

  /** Atalhos de teclado (ignorados enquanto se digita em um campo). */
  protected onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
    const id = this.selectedId();
    if (e.key === 'Escape') return this.selectedId.set(null);
    if (!id) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.remove(id);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicate();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.nudge(e.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // ---------- propriedades ----------

  protected setProp(key: string, value: string) {
    this.edit((d) => (this.selectedIn(d).props[key] = value));
  }

  protected setSpan(span: string) {
    this.edit((d) => (this.selectedIn(d).span = Number(span) || 12));
  }

  protected setVisibility(key: keyof ConditionDef, value: string) {
    this.edit((d) => {
      const c: ComponentDef = this.selectedIn(d);
      if (key === 'field' && !value) return void (c.visibleWhen = null);
      const current: ConditionDef = c.visibleWhen ?? { field: '', op: 'eq', value: null };
      c.visibleWhen = key === 'op' ? { ...current, op: value as ConditionOp } : { ...current, [key]: value };
    });
  }

  protected renamePage(name: string) {
    this.edit((d) => (this.pageOf(d).name = name));
  }
}
