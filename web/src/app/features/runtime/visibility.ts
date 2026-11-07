import { ConditionDef, CurrentUser, Props } from '../../core/models';

// Avaliação de condições no navegador (visibilidade de componentes).
// Espelha `Conditions.Evaluate` do backend (api/src/Domain/Workflows/WorkflowEngine.cs): mesmos operadores,
// comparação sem diferenciar maiúsculas, numérica quando os dois lados são números, {{variáveis}} no valor.

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

export function evaluate(condition: ConditionDef | null | undefined, vars: Vars): boolean {
  if (!condition?.field?.trim()) return true;
  const get = (name: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    return key ? (vars[key] ?? '') : '';
  };
  const actual = get(condition.field);
  const expected = (condition.value ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => get(name));
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
