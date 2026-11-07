import { ConditionDef, CurrentUser } from '../../core/models';
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
});
