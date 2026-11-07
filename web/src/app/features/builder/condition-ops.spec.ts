import { ConditionDef } from '../../core/models';
import { addRule, describeCondition, hasCondition, orNull, removeRule, rulesOf, setJoin, setRule } from './condition-ops';

// Editor de condição (visibilidade, automações e "se"): adicionar/remover regras e escolher E/OU.
describe('condition-ops', () => {
  const ops = { eq: '=', gt: '>', empty: 'vazio' };

  it('sem condição começa com uma regra vazia; preencher cria a condição', () => {
    expect(rulesOf(null)).toEqual([{ field: '', op: 'eq', value: null }]);
    const c = setRule(null, 0, 'field', 'status');
    expect(c).toEqual({ field: 'status', op: 'eq', value: null, join: 'and', more: [] });
    expect(hasCondition(c)).toBeTrue();
  });

  it('adicionar, editar e remover regras; a 2ª vira a 1ª ao remover a 1ª', () => {
    let c: ConditionDef = setRule(setRule(null, 0, 'field', 'status'), 0, 'value', 'Aberto');
    c = addRule(c);
    c = setRule(c, 1, 'field', 'valor');
    c = setRule(c, 1, 'op', 'gt');
    c = setRule(c, 1, 'value', '100');
    expect(describeCondition(c, ops)).toBe('status = Aberto e valor > 100');
    expect(describeCondition(setJoin(c, 'or'), ops)).toBe('status = Aberto ou valor > 100');

    c = removeRule(c, 0);
    expect(c.field).toBe('valor');
    expect(c.more).toEqual([]);
  });

  it('só regras com campo contam; sem nenhuma, a condição vira null', () => {
    const c = addRule(setRule(null, 0, 'field', 'anexo'));
    expect(describeCondition(setRule(c, 0, 'op', 'empty'), ops)).toBe('anexo vazio'); // regra 2 vazia ignorada
    expect(orNull(c)).toBe(c);
    expect(orNull(setRule(c, 0, 'field', ''))).toBeNull();
    expect(orNull(null)).toBeNull();
  });
});
