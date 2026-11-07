import { ConditionDef, ConditionJoin, ConditionOp, ConditionRule } from '../../core/models';
import { conditionRules } from '../runtime/visibility';

// Edição de condições com várias regras (E/OU). Funções puras: recebem a condição atual e devolvem uma nova.
// Usadas pelo editor de condição (visibilidade, automações de mini app e "se" dos workflows).

export const JOIN_OPTIONS: { value: ConditionJoin; label: string }[] = [
  { value: 'and', label: 'Todas (E)' },
  { value: 'or', label: 'Qualquer uma (OU)' },
];

type Cond = ConditionDef | null | undefined;
const blank = (): ConditionRule => ({ field: '', op: 'eq', value: null });
const joinOf = (c: Cond): ConditionJoin => (c?.join === 'or' ? 'or' : 'and');

/** Regras para editar (inclui as sem campo). Sem condição: uma regra vazia. */
export function rulesOf(c: Cond): ConditionRule[] {
  return c ? [{ field: c.field, op: c.op, value: c.value }, ...(c.more ?? [])] : [blank()];
}

function build(rules: ConditionRule[], join: ConditionJoin): ConditionDef {
  const [first, ...more] = rules.length ? rules : [blank()];
  return { ...first, join, more };
}

export function setRule(c: Cond, index: number, key: keyof ConditionRule, value: string): ConditionDef {
  const rules = rulesOf(c).map((r, i) =>
    i !== index ? r : key === 'op' ? { ...r, op: value as ConditionOp } : { ...r, [key]: value },
  );
  return build(rules, joinOf(c));
}

export const addRule = (c: Cond): ConditionDef => build([...rulesOf(c), blank()], joinOf(c));
export const removeRule = (c: Cond, index: number): ConditionDef => build(rulesOf(c).filter((_, i) => i !== index), joinOf(c));
export const setJoin = (c: Cond, join: ConditionJoin): ConditionDef => build(rulesOf(c), join);

export const hasCondition = (c: Cond): boolean => conditionRules(c).length > 0;
/** null quando nenhuma regra tem campo (= sem condição). */
export const orNull = (c: Cond): ConditionDef | null => (c && hasCondition(c) ? c : null);

/** "valor > 10 e status = Aberto", com os rótulos de operador de cada tela. */
export function describeCondition(c: Cond, opText: Record<string, string>): string {
  return conditionRules(c)
    .map((r) => {
      const op = opText[r.op] ?? r.op;
      return r.op === 'empty' || r.op === 'notEmpty' ? `${r.field} ${op}` : `${r.field} ${op} ${r.value ?? ''}`.trim();
    })
    .join(joinOf(c) === 'or' ? ' ou ' : ' e ');
}
