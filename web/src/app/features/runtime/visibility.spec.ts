import { ConditionDef, ConditionJoin, CurrentUser } from '../../core/models';
import { evaluate, visibilityVars } from './visibility';

// Visibilidade condicional: mesmas regras das condições de workflow do backend.
describe('visibilidade', () => {
  const ana: CurrentUser = { email: 'ana@corp.local', name: 'Ana', role: 'builder', department: 'RH' };
  const when = (field: string, op: ConditionDef['op'], value: string | null = null): ConditionDef => ({ field, op, value });

  it('sem condição (ou campo vazio) sempre mostra', () => {
    expect(evaluate(null, {})).toBeTrue();
    expect(evaluate(when('', 'eq', 'x'), {})).toBeTrue();
  });

  it('variáveis do usuário, sem diferenciar maiúsculas', () => {
    const vars = visibilityVars({}, ana, true);
    expect(evaluate(when('user.role', 'eq', 'BUILDER'), vars)).toBeTrue();
    expect(evaluate(when('user.department', 'neq', 'RH'), vars)).toBeFalse();
    expect(evaluate(when('user.canManage', 'eq', 'true'), vars)).toBeTrue();
    expect(evaluate(when('User.Email', 'contains', '@corp'), vars)).toBeTrue();
  });

  it('inputs da página: vazio, número e referência a outra variável', () => {
    const vars = visibilityVars({ tipo: '', valor: '1500', limite: '1000' }, ana, false);
    expect(evaluate(when('tipo', 'empty'), vars)).toBeTrue();
    expect(evaluate(when('valor', 'gt', '200'), vars)).toBeTrue(); // numérico, não texto ("1500" < "200" em texto)
    expect(evaluate(when('valor', 'gt', '{{limite}}'), vars)).toBeTrue();
    expect(evaluate(when('naoExiste', 'notEmpty'), vars)).toBeFalse();
  });

  // Mesmos casos de api/tests/Tests/ConditionTests.cs (Conditions.Evaluate precisa dar o mesmo resultado).
  describe('várias regras (E/OU)', () => {
    const vars = { tipo: 'Compra', valor: '1500', limite: '1000', 'user.department': 'RH' };
    const rules = (join: ConditionJoin, ...r: [string, ConditionDef['op'], string | null][]): ConditionDef => ({
      field: r[0][0], op: r[0][1], value: r[0][2], join,
      more: r.slice(1).map(([field, op, value]) => ({ field, op, value })),
    });

    it('E exige todas as regras e OU basta uma', () => {
      expect(evaluate(rules('and', ['tipo', 'eq', 'compra'], ['valor', 'gt', '{{limite}}']), vars)).toBeTrue();
      expect(evaluate(rules('and', ['tipo', 'eq', 'compra'], ['valor', 'lt', '200']), vars)).toBeFalse();
      expect(evaluate(rules('or', ['tipo', 'eq', 'Viagem'], ['user.department', 'eq', 'rh']), vars)).toBeTrue();
      expect(evaluate(rules('or', ['tipo', 'eq', 'Viagem'], ['valor', 'empty', null]), vars)).toBeFalse();
    });

    it('regras sem campo são ignoradas e condição vazia sempre vale', () => {
      expect(evaluate(rules('and', ['', 'eq', 'x'], ['tipo', 'eq', 'Compra']), vars)).toBeTrue();
      expect(evaluate(rules('or', ['', 'eq', 'x'], ['tipo', 'eq', 'Viagem']), vars)).toBeFalse();
      expect(evaluate(rules('or', ['', 'eq', 'x'], ['', 'eq', 'y']), vars)).toBeTrue();
    });

    it('definição antiga com uma regra continua valendo', () => {
      expect(evaluate({ field: 'tipo', op: 'eq', value: 'Compra' }, vars)).toBeTrue();
    });
  });
});
