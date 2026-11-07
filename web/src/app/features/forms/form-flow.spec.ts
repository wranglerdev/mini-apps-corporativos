import { AppDefinition, FieldDef, FormDef } from '../../core/models';
import { newField } from '../builder/editor-ops';
import { END, answerProblem, choicesOf, formPath, nextIndex } from './form-flow';
import { addJump, addQuestion, jumpTargets, moveQuestion, removeQuestion, setKind } from './form-ops';

/** Mesma pesquisa dos testes do backend (FormTests): Nota > 6 pula Melhorias; Contato = Não encerra. */
function survey(): { form: FormDef; fields: FieldDef[] } {
  const f = (id: string, name: string, type: FieldDef['type'] = 'text', options: string[] = []): FieldDef =>
    ({ ...newField(name, type, true), id, options });
  const fields = [
    f('f-nome', 'Nome'), f('f-area', 'Área', 'select', ['RH', 'TI']), f('f-nota', 'Nota', 'number'),
    f('f-melhorias', 'Melhorias'), f('f-contato', 'Contato', 'select', ['Sim', 'Não']), f('f-email', 'E-mail'),
  ];
  const q = (id: string, fieldId: string, kind: FormDef['questions'][number]['kind'], jumps: FormDef['questions'][number]['jumps'] = []) =>
    ({ id, fieldId, kind, title: id, description: '', jumps });
  const form: FormDef = {
    tableId: 'respostas', welcomeTitle: '', welcomeText: '', endTitle: 'Fim', endText: '', redirectUrl: null, public: false,
    questions: [
      q('q1', 'f-nome', 'short'), q('q2', 'f-area', 'choice'),
      q('q3', 'f-nota', 'scale', [{ op: 'gt', value: '6', goTo: 'q5' }]),
      q('q4', 'f-melhorias', 'long'),
      q('q5', 'f-contato', 'yesno', [{ op: 'eq', value: 'Não', goTo: END }]),
      q('q6', 'f-email', 'email'),
    ],
  };
  return { form, fields };
}

// Jornada 6 (front): respondente segue a lógica; builder monta perguntas.
describe('Formulário: caminho (igual ao FormFlow do backend)', () => {
  const { form, fields } = survey();
  const path = (answers: Record<string, string>) => formPath(form, fields, answers).map((q) => q.id).join(',');

  it('segue a lógica de pulo', () => {
    expect(path({ Nota: '9', Contato: 'Sim' })).toBe('q1,q2,q3,q5,q6');
    expect(path({ Nota: '6', Contato: 'Sim' })).toBe('q1,q2,q3,q4,q5,q6');
    expect(path({ Nota: '8', Contato: 'Não' })).toBe('q1,q2,q3,q5');
    expect(path({})).toBe('q1,q2,q3,q4,q5,q6');
  });

  it('próxima pergunta e fim', () => {
    expect(nextIndex(form, fields, 2, { Nota: '10' })).toBe(4);
    expect(nextIndex(form, fields, 4, { Contato: 'não' })).toBe(-1);
    expect(nextIndex(form, fields, 5, {})).toBe(-1);
  });

  it('valida a resposta antes de avançar', () => {
    const [nome, , , , , email] = form.questions;
    expect(answerProblem(nome, fields[0], '  ')).toBe('Responda para continuar.');
    expect(answerProblem(email, fields[5], 'marina')).toBe('Digite um e-mail válido.');
    expect(answerProblem(email, fields[5], 'marina@corp.local')).toBeNull();
    expect(answerProblem(nome, { ...fields[0], required: false }, '')).toBeNull();
  });

  it('opções com letra (seleção) ou inicial (sim/não)', () => {
    expect(choicesOf(form.questions[1], fields[1])).toEqual([{ key: 'A', label: 'RH' }, { key: 'B', label: 'TI' }]);
    expect(choicesOf(form.questions[4], fields[4]).map((c) => c.key)).toEqual(['S', 'N']);
  });
});

describe('Formulário: editor', () => {
  const def = (): AppDefinition => {
    const { form, fields } = survey();
    return { pages: [], workflows: [], form, tables: [{ id: 'respostas', name: 'Respostas', fields, permissions: { userCanCreate: true, userCanEdit: false, userCanDelete: false }, webhookKey: null }] };
  };

  it('nova pergunta cria o campo com tipo e opções do tipo', () => {
    const d = def();
    const q = addQuestion(d, 'choice', 1);
    const field = d.tables[0].fields.find((f) => f.id === q.fieldId)!;
    expect(d.form!.questions[1].id).toBe(q.id);
    expect(field.type).toBe('select');
    expect(field.options.length).toBe(2);
    expect(field.name).toBe('Pergunta 1');
    const second = addQuestion(d, 'short');
    expect(d.tables[0].fields.find((f) => f.id === second.fieldId)!.name).toBe('Pergunta 2');
  });

  it('trocar o tipo ajusta o campo e limpa as regras', () => {
    const d = def();
    setKind(d, 'q3', 'yesno');
    const field = d.tables[0].fields.find((f) => f.id === 'f-nota')!;
    expect(field.type).toBe('select');
    expect(field.options).toEqual(['Sim', 'Não']);
    expect(d.form!.questions[2].jumps).toEqual([]);
  });

  it('remover pergunta remove o campo e as regras que pulavam para ela', () => {
    const d = def();
    removeQuestion(d, 'q5');
    expect(d.tables[0].fields.some((f) => f.id === 'f-contato')).toBeFalse();
    expect(d.form!.questions[2].jumps).toEqual([]);
  });

  it('mover não deixa regra pulando para trás', () => {
    const d = def();
    moveQuestion(d, 'q5', -1); // q5 passa para antes de q4; q3 → q5 continua para frente
    expect(d.form!.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q5', 'q4', 'q6']);
    expect(d.form!.questions[2].jumps.length).toBe(1);
    moveQuestion(d, 'q5', -1); // agora q5 fica antes de q3: a regra de q3 cai
    expect(d.form!.questions.find((q) => q.id === 'q3')!.jumps).toEqual([]);
  });

  it('regra nova aponta para frente; destinos são as seguintes e o fim', () => {
    const d = def();
    expect(jumpTargets(d.form!, 'q5').map((t) => t.value)).toEqual(['q6', END]);
    const jump = addJump(d, 'q1')!;
    expect(jump.goTo).toBe('q3');
    expect(addJump(d, 'q6')!.goTo).toBe(END);
  });
});
