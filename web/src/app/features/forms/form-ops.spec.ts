import { AppDefinition } from '../../core/models';
import { addQuestion, addRedirectRule, answerVarsAt, formOf, redirectMode, setRedirectMode } from './form-ops';

// Jornada 6 (front): pergunta cita respostas anteriores ({{coluna}}), só as que já existem naquele ponto.
describe('Formulário: respostas anteriores', () => {
  const blank = (): AppDefinition => ({
    pages: [], workflows: [], tables: [{ id: 'r', name: 'Respostas', fields: [] }],
    form: { tableId: 'r', questions: [], welcomeTitle: '', welcomeText: '', endTitle: '', endText: '', redirectUrl: null, public: false },
  } as unknown as AppDefinition);

  it('na pergunta, só as anteriores; na tela final, todas', () => {
    const d = blank();
    const q1 = addQuestion(d, 'short');
    const q2 = addQuestion(d, 'email');
    const q3 = addQuestion(d, 'long');
    const names = (id: string | null) => answerVarsAt(d, id).map((v) => v.value);
    const [n1, n2, n3] = formOf(d).questions.map((q) => d.tables[0].fields.find((f) => f.id === q.fieldId)!.name);

    expect(names(q1.id)).toEqual([]);
    expect(names(q2.id)).toEqual([n1]);
    expect(names(q3.id)).toEqual([n1, n2]);
    expect(names(null)).toEqual([n1, n2, n3]);
    expect(answerVarsAt(d, q2.id)[0].about).toContain('pulou');
  });

  it('destino depois de enviar: ficar, link ou projeto; regra nasce sobre a 1ª pergunta', () => {
    const d = blank();
    addQuestion(d, 'short');
    expect(redirectMode(formOf(d))).toBe('none');
    setRedirectMode(d, 'project');
    expect(redirectMode(formOf(d))).toBe('project');
    expect(formOf(d).redirectUrl).toBeNull();
    setRedirectMode(d, 'url');
    expect([formOf(d).redirectUrl, formOf(d).redirectProjectId]).toEqual(['', null]);
    addRedirectRule(d);
    expect(formOf(d).redirectRules![0].condition.field).toBe(d.tables[0].fields[0].name);
  });
});
