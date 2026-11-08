import { applyCompletion, completionAt, filterSuggestions } from './completion';

// Jornada 7 (front): builder digita {{ e escolhe a variável em vez de lembrar o caminho.
describe('Autocomplete de variáveis', () => {
  const list = [{ value: 'cliente' }, { value: 'steps.api1.body' }, { value: 'steps.api1.status' }, { value: 'trigger.body.cliente' }];

  it('abre depois de um {{ sem fechar e usa o que foi digitado como filtro', () => {
    expect(completionAt('Olá {{cli', 9, 'template')).toEqual({ start: 4, query: 'cli' });
    expect(completionAt('Olá {{cliente}} ', 16, 'template')).toBeNull();
    expect(completionAt('sem chaves', 10, 'template')).toBeNull();
    expect(completionAt('steps.ap', 8, 'path')).toEqual({ start: 0, query: 'steps.ap' });
  });

  it('prefixo vem antes de "contém"; o valor já completo some da lista', () => {
    expect(filterSuggestions(list, 'cli').map((s) => s.value)).toEqual(['cliente', 'trigger.body.cliente']);
    expect(filterSuggestions(list, 'steps.api1').map((s) => s.value)).toEqual(['steps.api1.body', 'steps.api1.status']);
    expect(filterSuggestions(list, 'cliente').map((s) => s.value)).toEqual(['trigger.body.cliente']);
  });

  it('insere {{valor}} no lugar do trecho, fecha as chaves e põe o cursor depois', () => {
    expect(applyCompletion('Olá {{cli, tudo bem?', 9, 'template', 'cliente')).toEqual({ text: 'Olá {{cliente}}, tudo bem?', caret: 15 });
    // editando dentro de uma variável já fechada: não duplica o resto nem as chaves
    expect(applyCompletion('{{steps.ap}}', 10, 'template', 'steps.api1.body')).toEqual({ text: '{{steps.api1.body}}', caret: 19 });
    expect(applyCompletion('steps.ap', 8, 'path', 'steps.api1.body')).toEqual({ text: 'steps.api1.body', caret: 15 });
  });
});
