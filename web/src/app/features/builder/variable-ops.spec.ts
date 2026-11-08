import { AppDefinition, WorkflowDef } from '../../core/models';
import { actionSummary, newAction } from './editor-ops';
import { addVariable, autoMap, automationVarsAt, inputsProblem, prefillNames, renameInput, variableProblem } from './variable-ops';

// Jornada 3 (front): automações de mini app e formulário com variáveis, autocomplete e Transformar.
describe('Variáveis nas automações', () => {
  const app = (): AppDefinition => ({
    pages: [{ id: 'p1', name: 'Início', components: [{ id: 'c1', type: 'input', span: 12, props: { name: 'titulo', label: 'Título' } }] }],
    tables: [{ id: 't1', name: 'Pedidos', fields: [{ id: 'f1', name: 'Valor', type: 'number', required: false, options: [] }] }],
    workflows: [],
  } as unknown as AppDefinition);
  const wf = (type: WorkflowDef['trigger']['type'], tableId: string | null = null): WorkflowDef => ({
    id: 'w', name: 'Auto', trigger: { type, tableId }, condition: null, actions: [newAction('sendEmail'), newAction('callApi'), newAction('sendEmail')],
  });
  const values = (d: AppDefinition, w: WorkflowDef, i: number) => automationVarsAt(d, w, i).map((v) => v.value);

  it('contexto depende do gatilho: campos do registro, inputs da página ou now/today; user.* sempre', () => {
    const d = app();
    expect(values(d, wf('recordCreated', 't1'), 0)).toEqual(jasmine.arrayContaining(['Valor', 'id', 'user.email']));
    expect(values(d, wf('click'), 0)).toEqual(jasmine.arrayContaining(['titulo', 'user.name']));
    expect(values(d, wf('click'), 0)).not.toContain('Valor');
    expect(values(d, wf('schedule'), 0)).toEqual(jasmine.arrayContaining(['now', 'today']));
  });

  it('api.status/api.response só depois de um Chamar API; apelido de api.response só ali também', () => {
    const d = app();
    const w = wf('click');
    addVariable(w, 'resposta', 'object', 'api.response');
    addVariable(w, 'total', 'number');
    expect(values(d, w, 1)).not.toContain('api.response');
    expect(values(d, w, 1)).not.toContain('resposta');
    expect(values(d, w, 1)).toContain('total');
    expect(values(d, w, 2)).toEqual(jasmine.arrayContaining(['api.status', 'api.response', 'resposta']));
  });

  it('formulário: campos da tabela de respostas aparecem como Respostas', () => {
    const d = { ...app(), form: { tableId: 't1' } } as unknown as AppDefinition;
    const item = automationVarsAt(d, wf('recordCreated', 't1'), 0).find((v) => v.value === 'Valor')!;
    expect(item.group).toBe('Respostas');
    expect(item.about).toContain('Resposta');
  });

  it('variável não esconde campo nem input; Transformar resume os destinos', () => {
    const w = wf('click');
    const v = addVariable(w, 'Valor');
    expect(variableProblem(w, v, ['Valor', 'titulo'])).toContain('campo');
    const t = newAction('transform');
    t.ops = [{ target: 'total', op: 'count', input: '{{api.response}}' }];
    expect(actionSummary(app(), t)).toBe('total ←');
  });

  it('escolher o workflow liga entradas aos valores de mesmo nome (sem acento/maiúscula/espaço), sem sobrescrever', () => {
    expect(autoMap(['nome', 'area', 'nota'], ['Nome', 'Área', 'id'], { nota: '10' })).toEqual({ nome: '{{Nome}}', area: '{{Área}}', nota: '10' });
  });

  it('pré-preenchimento: colunas das perguntas no formulário, inputs no mini app', () => {
    const form = { ...app(), form: { tableId: 't1', questions: [{ id: 'q', fieldId: 'f1', kind: 'number', title: 'Valor?', description: '', jumps: [] }] } } as unknown as AppDefinition;
    expect(prefillNames(form)).toEqual(['Valor']);
    expect(prefillNames(app())).toEqual(['titulo']);
  });

  it('entrada do gatilho "call": renomear atualiza {{input.x}}; esquema inválido explica', () => {
    const w = wf('click');
    w.trigger = { type: 'call', tableId: null, inputs: [{ name: 'nome', type: 'text' }] };
    w.actions[0].params['subject'] = 'Olá {{input.nome}}';
    renameInput(w, 'nome', 'cliente');
    expect(w.actions[0].params['subject']).toBe('Olá {{input.cliente}}');
    expect(inputsProblem([{ name: 'n', type: 'number', default: 'x' }])).toContain('número');
    expect(inputsProblem([{ name: 'a', type: 'text' }, { name: 'A', type: 'text' }])).toContain('Já existe');
    expect(inputsProblem([{ name: 'user', type: 'text' }])).toBeNull(); // entradas vivem em input.*
  });
});
