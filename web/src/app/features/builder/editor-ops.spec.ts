import { AppDefinition, PageDef } from '../../core/models';
import {
  ACTION_TYPES, COMPONENT_TYPES, PALETTE_GROUPS, actionSummary, conditionSummary, triggerSummary,
  MAX_DEPTH, addTable, editorTab, duplicateComponent, nudgeComponent, outline, pathTo, scheduleLabel, findComponent, flatten, generatePageForTable, insertComponent, moveComponent, newComponent,
  removeComponent, removeTable,
} from './editor-ops';

// Jornada 1 (front): builder monta páginas, containers e dados no editor.
describe('editor-ops', () => {
  const blank = (): AppDefinition => ({ pages: [{ id: 'home', name: 'Início', components: [] }], tables: [], workflows: [] });
  const types = (list: { type: string }[]) => list.map((c) => c.type);

  it('cria componente com largura e props padrão do tipo; container nasce com filhos vazios', () => {
    const c = newComponent('button');
    expect(c.span).toBe(3);
    expect(c.props['label']).toBe('Enviar');
    expect(newComponent('container').children).toEqual([]);
  });

  it('insere (drop da paleta) na posição indicada da página', () => {
    const page = blank().pages[0];
    insertComponent(page, 'text');
    insertComponent(page, 'table');
    insertComponent(page, 'button', 1);
    expect(types(page.components)).toEqual(['text', 'button', 'table']);
  });

  it('move (drag no canvas) para frente e para trás na mesma lista', () => {
    const page = blank().pages[0];
    const [a, , c] = (['text', 'button', 'table'] as const).map((t) => insertComponent(page, t)!);
    moveComponent(page, a.id, null, 3); // primeiro para o fim
    expect(types(page.components)).toEqual(['button', 'table', 'text']);
    moveComponent(page, c.id, null, 0); // tabela para o início
    expect(types(page.components)).toEqual(['table', 'button', 'text']);
  });

  describe('containers', () => {
    let page: PageDef;
    beforeEach(() => (page = blank().pages[0]));

    it('insere dentro do container e move para dentro e para fora', () => {
      const box = insertComponent(page, 'container')!;
      const text = insertComponent(page, 'text')!;
      insertComponent(page, 'button', undefined, box.id);

      expect(moveComponent(page, text.id, box.id, 0)).toBeTrue();
      expect(types(page.components)).toEqual(['container']);
      expect(types(box.children!)).toEqual(['text', 'button']);

      expect(moveComponent(page, text.id, null, 0)).toBeTrue();
      expect(types(page.components)).toEqual(['text', 'container']);
    });

    it('não deixa mover um container para dentro dele mesmo ou de um filho', () => {
      const outer = insertComponent(page, 'container')!;
      const inner = insertComponent(page, 'container', undefined, outer.id)!;
      expect(moveComponent(page, outer.id, outer.id, 0)).toBeFalse();
      expect(moveComponent(page, outer.id, inner.id, 0)).toBeFalse();
      expect(findComponent(page.components, inner.id)?.depth).toBe(2);
    });

    it(`respeita o limite de ${MAX_DEPTH} níveis ao inserir e ao mover`, () => {
      let parent: string | null = null;
      for (let i = 0; i < MAX_DEPTH; i++) parent = insertComponent(page, 'container', undefined, parent)!.id;
      expect(insertComponent(page, 'text', undefined, parent)).toBeNull(); // seria o 5º nível

      const loose = insertComponent(page, 'container')!;
      insertComponent(page, 'text', undefined, loose.id);
      const third = flatten(page.components).filter((c) => c.type === 'container')[2];
      expect(moveComponent(page, loose.id, third.id, 0)).toBeFalse(); // 3 + 2 níveis
    });

    it('remove em qualquer nível e excluir tabela limpa componentes dentro de containers', () => {
      const def = blank();
      const table = addTable(def, 'Pedidos');
      const p = def.pages[0];
      const box = insertComponent(p, 'container')!;
      insertComponent(p, 'table', undefined, box.id)!.props['tableId'] = table.id;
      const keep = insertComponent(p, 'text', undefined, box.id)!;

      removeTable(def, table.id);
      expect(types(p.components[0].children!)).toEqual(['text']);

      removeComponent(p, keep.id);
      expect(p.components[0].children).toEqual([]);
    });
  });

  it('gera página com formulário e tabela a partir da tabela', () => {
    const def = blank();
    const table = addTable(def, 'Pedidos');
    const page = generatePageForTable(def, table.id);
    expect(def.pages.length).toBe(2);
    expect(types(page.components)).toEqual(['text', 'form', 'table']);
    expect(page.components[1].props['tableId']).toBe(table.id);
  });

  it('excluir tabela limpa workflows que a usavam', () => {
    const def = blank();
    const table = addTable(def, 'Pedidos');
    def.workflows.push({ id: 'w', name: 'w', trigger: { type: 'recordCreated', tableId: table.id }, condition: null, actions: [] });
    removeTable(def, table.id);
    expect(def.tables).toEqual([]);
    expect(def.workflows).toEqual([]);
  });

  it('descreve gatilhos agendados em português', () => {
    const t = (frequency: 'hourly' | 'daily' | 'weekly', time: string | null = null, dayOfWeek: number | null = null) =>
      ({ type: 'schedule' as const, tableId: null, frequency, time, dayOfWeek });
    expect(scheduleLabel(t('hourly'))).toBe('A cada hora, no minuto 00');
    expect(scheduleLabel(t('daily', '08:00'))).toBe('Todo dia às 08:00');
    expect(scheduleLabel(t('weekly', '09:30', 1))).toBe('Toda segunda às 09:30');
    expect(scheduleLabel(t('weekly', '09:30', 0))).toBe('Todo domingo às 09:30');
    expect(scheduleLabel(t('weekly', null, 1))).toBe('Semanal: escolha dia e horário');
  });

  it('duplica com ids novos em toda a subárvore, logo abaixo do original', () => {
    const page = blank().pages[0];
    const box = insertComponent(page, 'container')!;
    const inner = insertComponent(page, 'text', undefined, box.id)!;
    insertComponent(page, 'button');

    const copy = duplicateComponent(page, box.id)!;

    expect(types(page.components)).toEqual(['container', 'container', 'button']);
    expect(copy.id).not.toBe(box.id);
    expect(copy.children![0].id).not.toBe(inner.id);
    expect(copy.children![0].props).toEqual(inner.props);
  });

  it('sobe e desce dentro do mesmo pai, sem passar das pontas', () => {
    const page = blank().pages[0];
    const [a, b] = (['text', 'button'] as const).map((t) => insertComponent(page, t)!);
    expect(nudgeComponent(page, a.id, -1)).toBeFalse();
    expect(nudgeComponent(page, a.id, 1)).toBeTrue();
    expect(types(page.components)).toEqual(['button', 'text']);
    expect(nudgeComponent(page, b.id, -1)).toBeFalse();
  });

  it('caminho e estrutura da árvore para navegar em componentes aninhados', () => {
    const page = blank().pages[0];
    const box = insertComponent(page, 'container')!;
    const inner = insertComponent(page, 'container', undefined, box.id)!;
    const leaf = insertComponent(page, 'text', undefined, inner.id)!;

    expect(pathTo(page.components, leaf.id).map((c) => c.id)).toEqual([box.id, inner.id, leaf.id]);
    expect(outline(page.components).map((x) => x.depth)).toEqual([0, 1, 2]);
  });

  it('paleta agrupada contém cada componente exatamente uma vez', () => {
    const types = PALETTE_GROUPS.flatMap((g) => g.types);
    expect([...types].sort()).toEqual([...COMPONENT_TYPES].sort());
  });

  it('resumos dos nós do workflow (gatilho, condição, passos)', () => {
    const def: AppDefinition = {
      pages: [{ id: 'p1', name: 'Início', components: [] }],
      tables: [{ id: 't1', name: 'Pedidos', fields: [], permissions: { userCanCreate: true, userCanEdit: true, userCanDelete: true }, webhookKey: null }],
      workflows: [{ id: 'w1', name: 'Avisar', trigger: { type: 'click', tableId: null }, condition: null, actions: [] }],
    };
    expect(triggerSummary(def, { type: 'recordCreated', tableId: 't1' })).toBe('Na tabela Pedidos');
    expect(triggerSummary(def, { type: 'recordUpdated', tableId: null })).toBe('Escolha a tabela');
    expect(triggerSummary(def, { type: 'schedule', tableId: null, frequency: 'daily', time: '08:00' })).toBe('Todo dia às 08:00');
    expect(conditionSummary(null)).toBe('');
    expect(conditionSummary({ field: 'status', op: 'eq', value: 'Aberto' })).toBe('status = Aberto');
    expect(conditionSummary({ field: 'anexo', op: 'empty', value: 'x' })).toBe('anexo está vazio');
    const step = (type: (typeof ACTION_TYPES)[number], params: Record<string, string>) => actionSummary(def, { type, params, values: {} });
    expect(step('createRecord', { tableId: 't1' })).toBe('Na tabela Pedidos');
    expect(step('sendEmail', {})).toBe('Escolha o destinatário');
    expect(step('callApi', { method: 'GET', url: 'https://x' })).toBe('GET https://x');
    expect(step('navigate', { pageId: 'p1' })).toBe('Início');
    expect(step('runWorkflow', { workflowId: 'w1' })).toBe('Avisar');
    expect(ACTION_TYPES.every((t) => step(t, {}).length > 0)).toBeTrue();
  });

  it('aba do editor vem da URL (?aba=) para reload e link; inválida ou de outro tipo cai na primeira do tipo', () => {
    expect(editorTab('workflow', 'execucoes')).toBe('execucoes');
    expect(editorTab('form', 'respostas')).toBe('respostas');
    expect(editorTab('app', 'publicacao')).toBe('publicacao');
    expect(editorTab('app', undefined)).toBe('design');
    expect(editorTab('form', 'design')).toBe('perguntas');
    expect(editorTab('workflow', 'xyz')).toBe('workflow');
  });
});
