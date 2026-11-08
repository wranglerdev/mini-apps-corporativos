import { AppDefinition, RunStep } from '../../core/models';
import {
  testValue, cronLabel, duration, flowOf, flowTriggerSummary, idProblem, insertNear, locate, moveStep, outputPaths, removeStep,
  renameStep, resultsByStep, stepSummary, variablesAt, waterfall,
} from './flow-ops';
import { addVariable, removeVariable, renameVariable, variableProblem } from '../builder/variable-ops';

// Jornada 7 (front): builder monta o workflow e lê as execuções.
describe('Workflow: editor', () => {
  const blank = (): AppDefinition => ({
    pages: [], tables: [], automation: true,
    workflows: [{ id: 'w', name: 'Resumo', trigger: { type: 'manual', tableId: null }, condition: null, actions: [] }],
  });

  it('paleta insere no fim, depois do selecionado ou dentro do "se"/"para cada"; ids únicos por tipo', () => {
    const d = blank();
    const api = insertNear(d, 'callApi', null);
    const se = insertNear(d, 'if', api.id!);
    const email = insertNear(d, 'sendEmail', se.id!);
    const fim = insertNear(d, 'sendEmail', null);
    expect(flowOf(d).actions.map((s) => s.id)).toEqual(['api1', 'se1', 'email2']);
    expect(se.steps!.map((s) => s.id)).toEqual(['email1']);
    expect(email.retries).toBe(2);
    expect(api.retries).toBe(3);
    expect(fim.id).toBe('email2');
    expect(insertNear(d, 'wait', se.id!, 'else').id).toBe('espera1');
    expect(se.else!.length).toBe(1);
  });

  it('remover e mover só dentro da mesma lista', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    const se = insertNear(d, 'if', null);
    insertNear(d, 'sendEmail', se.id!);
    moveStep(d, 'se1', -1);
    expect(flowOf(d).actions.map((s) => s.id)).toEqual(['se1', 'api1']);
    moveStep(d, 'email1', -1); // já é o primeiro do "então"
    removeStep(d, 'email1');
    expect(locate(flowOf(d).actions, 'email1')).toBeNull();
  });

  it('renomear id atualiza as referências {{steps.x.…}} e valida o id', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    const email = insertNear(d, 'sendEmail', 'api1');
    email.params['subject'] = 'Total {{steps.api1.body.total}}';
    const se = insertNear(d, 'if', 'email1');
    se.condition = { field: 'steps.api1.status', op: 'eq', value: '200', join: 'or', more: [{ field: 'steps.api1.body.total', op: 'gt', value: '0' }] };
    renameStep(d, 'api1', 'buscar');
    expect(email.params['subject']).toBe('Total {{steps.buscar.body.total}}');
    expect(se.condition.field).toBe('steps.buscar.status');
    expect(se.condition.more![0].field).toBe('steps.buscar.body.total');
    expect(stepSummary(se)).toBe('steps.buscar.status = 200 ou steps.buscar.body.total > 0');
    expect(idProblem(d, 'email1', 'buscar')).toContain('Já existe');
    expect(idProblem(d, 'email1', '9x')).not.toBeNull();
    expect(idProblem(d, 'email1', 'avisar')).toBeNull();
  });

  it('variáveis do passo: gatilho, passos anteriores (fora dele mesmo), item do "para cada" e segredos', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    const cada = insertNear(d, 'forEach', 'api1');
    cada.params['as'] = 'chamado';
    insertNear(d, 'sendEmail', cada.id!);
    const vars = variablesAt(d, 'email1').map((v) => v.value);
    expect(vars).toContain('steps.api1.body');
    expect(vars).toContain('chamado');
    expect(vars).not.toContain('steps.cada1');
    expect(vars).not.toContain('steps.email1');
    expect(vars.at(-1)).toBe('secrets.NOME');
    // no gatilho ainda não há saída de passo
    expect(variablesAt(d, 'trigger').some((v) => v.group === 'Passos')).toBeFalse();
  });

  it('caminhos reais da saída do último teste entram no autocomplete', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    insertNear(d, 'sendEmail', 'api1');
    const vars = variablesAt(d, 'email1', { api1: '{"status":200,"body":{"cliente":{"nome":"Ana"},"itens":[1,2]}}' }).map((v) => v.value);
    expect(vars).toContain('steps.api1.body.cliente.nome');
    expect(vars).toContain('steps.api1.body.itens.count');
    expect(outputPaths('x', 'não é json')).toEqual([]);
    // apelido herda os caminhos da origem
    addVariable(flowOf(d), 'pedido', 'object', 'steps.api1.body');
    const withAlias = variablesAt(d, 'email1', { api1: '{"body":{"cliente":{"nome":"Ana"}}}' }).map((v) => v.value);
    expect(withAlias).toContain('pedido.cliente.nome');
  });

  it('tooltip: o básico da variável e o valor no último teste', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    const t = insertNear(d, 'transform', 'api1');
    insertNear(d, 'sendEmail', t.id!);
    addVariable(flowOf(d), 'pedido', 'object', 'steps.api1.body');
    addVariable(flowOf(d), 'total', 'number');
    t.ops = [{ target: 'total', op: 'count', input: '{{pedido.itens}}' }];
    const outputs = { api1: '{"status":200,"body":{"cliente":"Ana","itens":[1,2]}}', dados1: '{"total":2}' };

    const total = variablesAt(d, 'email1').find((v) => v.value === 'total')!;
    expect(total.about).toContain('Número');
    expect(total.empty).toBe('0');
    expect(variablesAt(d, 'email1').find((v) => v.value === 'pedido')!.about).toContain('apelido de steps.api1.body');

    expect(testValue(flowOf(d), 'pedido.cliente', outputs)).toBe('"Ana"');
    expect(testValue(flowOf(d), 'steps.api1.body.itens.count', outputs)).toBe('2');
    expect(testValue(flowOf(d), 'total', outputs)).toBe('2');
    expect(testValue(flowOf(d), 'total', {})).toBeNull();
  });

  it('variável: tipo, padrão e apelido; apelido só aparece depois do passo de origem', () => {
    const d = blank();
    insertNear(d, 'sendEmail', null);
    insertNear(d, 'callApi', 'email1');
    insertNear(d, 'sendEmail', 'api1');
    const total = addVariable(flowOf(d), 'total', 'number');
    const cliente = addVariable(flowOf(d), 'cliente', 'object', 'steps.api1.body.cliente');
    expect(addVariable(flowOf(d), 'total').name).toBe('total1');

    expect(variablesAt(d, 'email1').map((v) => v.value)).toContain('total');
    expect(variablesAt(d, 'email1').map((v) => v.value)).not.toContain('cliente');
    expect(variablesAt(d, 'email2').map((v) => v.value)).toContain('cliente');

    expect(variableProblem(flowOf(d), { ...total, default: 'dez' })).toContain('número');
    expect(variableProblem(flowOf(d), { ...total, default: '10,5' })).toBeNull();
    expect(variableProblem(flowOf(d), { ...cliente, default: '[1]' })).toContain('objeto');
    expect(variableProblem(flowOf(d), { ...cliente, from: '{{steps.api1.body}}' })).toContain('caminho');
    expect(variableProblem(flowOf(d), { name: 'steps', type: 'text' })).toContain('reservado');
  });

  it('renomear variável ou passo atualiza referências, apelidos e destinos do Transformar; remover leva as operações', () => {
    const d = blank();
    insertNear(d, 'callApi', null);
    const t = insertNear(d, 'transform', 'api1');
    const email = insertNear(d, 'sendEmail', t.id!);
    addVariable(flowOf(d), 'cliente', 'object', 'steps.api1.body');
    addVariable(flowOf(d), 'nome');
    t.ops = [{ target: 'nome', op: 'get', input: '{{cliente}}', arg: 'nome' }];
    email.params['subject'] = 'Olá {{ nome }} ({{cliente.email}}) {{nomeCompleto}}';

    renameVariable(flowOf(d), 'nome', 'nomeCliente');
    renameVariable(flowOf(d), 'cliente', 'pessoa');
    renameStep(d, 'api1', 'buscar');

    expect(email.params['subject']).toBe('Olá {{ nomeCliente }} ({{pessoa.email}}) {{nomeCompleto}}');
    expect(t.ops[0]).toEqual({ target: 'nomeCliente', op: 'get', input: '{{pessoa}}', arg: 'nome' });
    expect(flowOf(d).variables![0].from).toBe('steps.buscar.body');
    expect(stepSummary(t)).toBe('nomeCliente ←');

    removeVariable(flowOf(d), 'nomeCliente');
    expect(t.ops).toEqual([]);
  });

  it('resumos do gatilho e dos passos', () => {
    expect(cronLabel('0 8 * * 1-5')).toBe('Dias úteis às 08:00');
    expect(cronLabel('30 7 * * *')).toBe('Todo dia às 07:30');
    expect(cronLabel('*/15 * * * *')).toBe('Cron: */15 * * * *');
    expect(flowTriggerSummary({ type: 'webhook', tableId: null })).toBe('Gere a chave do webhook');
    expect(stepSummary({ type: 'if', params: {}, values: {}, condition: { field: 'steps.api1.body.total', op: 'gt', value: '0' } })).toBe('steps.api1.body.total > 0');
    expect(stepSummary({ type: 'transform', params: {}, values: { total: '1', altas: '2' } })).toBe('total, altas');
  });
});

describe('Workflow: execuções', () => {
  const step = (order: number, stepId: string | null, startMs: number, endMs: number | null, status: RunStep['status'] = 'succeeded'): RunStep => ({
    id: `s${order}`, runId: 'r', parentId: null, order, depth: 0, stepId, name: stepId ?? 'Tentativa', type: 'callApi', status,
    startedAt: new Date(1_000_000 + startMs).toISOString(), finishedAt: endMs === null ? null : new Date(1_000_000 + endMs).toISOString(),
    input: null, output: null, error: null,
  });

  it('linha do tempo posiciona cada trecho entre o 1º início e o último fim', () => {
    const { rows, totalMs } = waterfall([step(1, 'b', 1000, 2000), step(0, 'a', 0, 1000)]);
    expect(totalMs).toBe(2000);
    expect(rows.map((r) => r.step.stepId)).toEqual(['a', 'b']);
    expect(rows[1].leftPct).toBe(50);
    expect(rows[1].widthPct).toBe(50);
    expect(rows[1].startText).toBe('+1,00 s');
  });

  it('resultado por passo soma as repetições do "para cada" e falha vence', () => {
    const r = resultsByStep([step(0, 'email1', 0, 100), step(1, 'email1', 100, 300, 'failed'), step(2, null, 0, 10)]);
    expect(r['email1'].status).toBe('failed');
    expect(r['email1'].text).toBe('Falhou · 2× · 300 ms');
    expect(duration(3420)).toBe('3,42 s');
  });
});
