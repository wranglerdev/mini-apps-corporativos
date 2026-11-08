import { ConditionDef, ConditionRule, CurrentUser, Props } from '../../core/models';

// Avaliação de condições no navegador (visibilidade de componentes).
// Espelha `Conditions.Evaluate` do backend (api/src/Domain/Workflows/WorkflowEngine.cs): mesmos operadores,
// comparação sem diferenciar maiúsculas, numérica quando os dois lados são números, {{variáveis}} no valor,
// várias regras com E (join 'and', padrão) ou OU (join 'or'); regra sem campo é ignorada.

export const CONDITION_OPS = [
  { value: 'eq', label: 'igual a' },
  { value: 'neq', label: 'diferente de' },
  { value: 'gt', label: 'maior que' },
  { value: 'lt', label: 'menor que' },
  { value: 'contains', label: 'contém' },
  { value: 'empty', label: 'está vazio' },
  { value: 'notEmpty', label: 'está preenchido' },
];

/** Variáveis que o builder pode usar além dos campos de entrada da página. */
export const USER_VARIABLES = [
  { value: 'user.role', label: 'Papel do usuário (admin, builder, user)' },
  { value: 'user.department', label: 'Departamento do usuário' },
  { value: 'user.canManage', label: 'Gerencia este app (true/false)' },
  { value: 'user.email', label: 'E-mail do usuário' },
];

export type Vars = Record<string, string | null | undefined>;

export function visibilityVars(inputs: Props, user: CurrentUser | null, canManage: boolean): Vars {
  return {
    ...inputs,
    'user.email': user?.email,
    'user.name': user?.name,
    'user.role': user?.role,
    'user.department': user?.department,
    'user.canManage': String(canManage),
  };
}

/** Regras que valem (com campo): a 1ª vem dos campos da própria condição, as demais de `more`. */
export function conditionRules(c: ConditionDef | null | undefined): ConditionRule[] {
  return c ? [c, ...(c.more ?? [])].filter((r) => r.field?.trim()) : [];
}

export function evaluate(condition: ConditionDef | null | undefined, vars: Vars): boolean {
  const rules = conditionRules(condition);
  if (!rules.length) return true;
  const ok = (r: ConditionRule) => matches(r, vars);
  return condition?.join === 'or' ? rules.some(ok) : rules.every(ok);
}

/** Valor da variável sem diferenciar maiúsculas; ausente vira vazio. */
function lookup(vars: Vars, name: string): string {
  const key = Object.keys(vars).find((k) => k.toLowerCase() === name.trim().toLowerCase());
  return key ? (vars[key] ?? '') : '';
}

/**
 * Troca {{variável}} pelo valor (ausente vira vazio). Espelha `Template.Render` do backend; usado no valor das condições
 * e nos textos do app (texto, card, título de container, rótulo de botão).
 */
export function render(text: string | null | undefined, vars: Vars): string {
  return (text ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => lookup(vars, name));
}

function matches(condition: ConditionRule, vars: Vars): boolean {
  const actual = lookup(vars, condition.field);
  const expected = render(condition.value, vars);
  const [a, b] = [Number(actual), Number(expected)];
  const numeric = actual.trim() !== '' && expected.trim() !== '' && !isNaN(a) && !isNaN(b);
  const same = actual.localeCompare(expected, undefined, { sensitivity: 'accent' }) === 0;

  switch (condition.op) {
    case 'eq': return same;
    case 'neq': return !same;
    case 'gt': return numeric ? a > b : actual > expected;
    case 'lt': return numeric ? a < b : actual < expected;
    case 'contains': return actual.toLowerCase().includes(expected.toLowerCase());
    case 'empty': return actual === '';
    case 'notEmpty': return actual !== '';
    default: return true; // condição mal configurada não esconde nada
  }
}
