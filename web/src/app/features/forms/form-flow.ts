import { FieldDef, FieldType, FormDef, Props, QuestionDef, QuestionKind } from '../../core/models';
import { evaluate } from '../runtime/visibility';

// Regras puras do formulário (testadas em form-flow.spec.ts).
// O CAMINHO é a mesma regra de FormFlow (api/src/Domain/Forms/FormDefinition.cs): mudou um, mude o outro e os testes.

export const END = 'end';

export interface QuestionKindSpec {
  label: string;
  icon: string;
  fieldType: FieldType;
}

/** Tipos de pergunta, na ordem da paleta. `file` existe no backend e fica fora da paleta até haver envio sem login. */
export const QUESTION_KINDS: Record<QuestionKind, QuestionKindSpec> = {
  short: { label: 'Texto curto', icon: 'text', fieldType: 'text' },
  long: { label: 'Texto longo', icon: 'list', fieldType: 'text' },
  email: { label: 'E-mail', icon: 'sendEmail', fieldType: 'text' },
  number: { label: 'Número', icon: 'chart', fieldType: 'number' },
  date: { label: 'Data', icon: 'schedule', fieldType: 'date' },
  choice: { label: 'Seleção', icon: 'list', fieldType: 'select' },
  yesno: { label: 'Sim/Não', icon: 'requestApproval', fieldType: 'select' },
  scale: { label: 'Escala 0–10', icon: 'chart', fieldType: 'number' },
  file: { label: 'Arquivo', icon: 'recordCreated', fieldType: 'file' },
};

export const PALETTE_KINDS: QuestionKind[] = ['short', 'long', 'email', 'number', 'date', 'choice', 'yesno', 'scale'];
export const YES_NO = ['Sim', 'Não'];
export const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Índice da próxima pergunta depois de `index` (-1 = fim). A primeira regra que bater vence; pulos só vão para frente. */
export function nextIndex(form: FormDef, fields: FieldDef[], index: number, answers: Props): number {
  const q = form.questions[index];
  const field = fields.find((f) => f.id === q.fieldId);
  for (const jump of q.jumps) {
    if (!field || !evaluate({ field: field.name, op: jump.op, value: jump.value }, answers)) continue;
    if (jump.goTo === END) return -1;
    const target = form.questions.findIndex((x) => x.id === jump.goTo);
    return target > index ? target : index + 1;
  }
  return index + 1 < form.questions.length ? index + 1 : -1;
}

/** Perguntas que o respondente vê, na ordem, dadas as respostas (por nome de campo). */
export function formPath(form: FormDef, fields: FieldDef[], answers: Props): QuestionDef[] {
  const path: QuestionDef[] = [];
  for (let i = 0; i >= 0 && i < form.questions.length; i = nextIndex(form, fields, i, answers)) path.push(form.questions[i]);
  return path;
}

/** Problema da resposta atual antes de avançar (null = pode seguir). Espelha a validação do envio no backend. */
export function answerProblem(q: QuestionDef, field: FieldDef | undefined, value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return field?.required ? 'Responda para continuar.' : null;
  if (q.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Digite um e-mail válido.';
  if (q.kind === 'number' && isNaN(Number(v.replace(',', '.')))) return 'Digite um número.';
  return null;
}

/** Opções de resposta de perguntas de escolha, com a letra/tecla de cada uma. */
export function choicesOf(q: QuestionDef, field: FieldDef | undefined): { key: string; label: string }[] {
  const options = q.kind === 'yesno' ? YES_NO : q.kind === 'choice' ? (field?.options ?? []) : [];
  return options.map((label, i) => ({ key: q.kind === 'yesno' ? label[0] : String.fromCharCode(65 + i), label }));
}

/** Progresso (0–100) ao estar na pergunta `index`. */
export const progressAt = (form: FormDef, index: number) =>
  form.questions.length ? Math.round((Math.max(0, index) / form.questions.length) * 100) : 0;
