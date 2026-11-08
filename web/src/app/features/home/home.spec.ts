import { AppSummary } from '../../core/models';
import { PROJECT_KINDS, SKETCH_MAX, projectMenu, recentProjects, runLink, sketchBlocks } from './home';

// Início: o que dá para criar, projetos recentes e miniaturas.
describe('Início', () => {
  const app = (id: string, updatedAt: string, kind: AppSummary['kind'] = 'app') => ({ id, updatedAt, kind }) as AppSummary;

  it('tipos de projeto: mini app, formulário e workflow disponíveis', () => {
    expect(PROJECT_KINDS.map((k) => [k.kind, k.ready])).toEqual([['app', true], ['form', true], ['workflow', true], ['catalog', false]]);
  });

  it('formulário abre em /f e mini app em /run', () => {
    expect(runLink({ kind: 'form', slug: 'pesquisa' })).toEqual(['/f', 'pesquisa']);
    expect(runLink({ kind: 'app', slug: 'pedidos' })).toEqual(['/run', 'pedidos']);
  });

  it('projetos recentes primeiro, limitados, sem alterar a lista', () => {
    const list = [app('a', '2026-11-01'), app('b', '2026-11-06'), app('c', '2026-11-03')];
    expect(recentProjects(list, '', 2).map((a) => a.id)).toEqual(['b', 'c']);
    expect(list.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('filtro por tipo', () => {
    const list = [app('a', '2026-11-01'), app('f', '2026-11-02', 'form')];
    expect(recentProjects(list, 'app').map((p) => p.id)).toEqual(['a']);
    expect(recentProjects(list, 'form').map((p) => p.id)).toEqual(['f']);
    expect(recentProjects([...list, app('w', '2026-11-03', 'workflow')], 'workflow').map((p) => p.id)).toEqual(['w']);
  });

  it('miniatura usa os primeiros componentes com largura válida', () => {
    expect(sketchBlocks(null)).toEqual([]);
    const many = Array.from({ length: 12 }, () => ({ type: 'text' as const, span: 12 }));
    expect(sketchBlocks(many).length).toBe(SKETCH_MAX);
    expect(sketchBlocks([{ type: 'chart', span: 30 }, { type: 'button', span: 0 }]).map((b) => b.span)).toEqual([12, 12]);
    expect(sketchBlocks([{ type: 'button', span: 3 }])[0]).toEqual({ type: 'button', span: 3 });
  });

  it('menu do card: abrir só publicado e fora de workflow; excluir confirma no próprio menu', () => {
    const values = (kind: 'app' | 'form' | 'workflow', v: number | null, c = false) => projectMenu({ kind, publishedVersion: v }, c).map((i) => i.value);
    expect(values('app', 2)).toEqual(['edit', 'open', 'duplicate', 'delete']);
    expect(values('app', null)).toEqual(['edit', 'duplicate', 'delete']);
    expect(values('workflow', 1)).toEqual(['edit', 'duplicate', 'delete']);
    expect(projectMenu({ kind: 'form', publishedVersion: 1 }, true).at(-1)!.label).toBe('Confirmar exclusão');
  });
});
