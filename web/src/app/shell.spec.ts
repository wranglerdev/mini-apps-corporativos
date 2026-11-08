import { CurrentUser } from './core/models';
import { isBareRoute, isToolRoute, navItems, nextTheme } from './shell';

// Moldura: o que cada papel enxerga na barra lateral, quando ela recolhe e o ciclo de tema.
describe('Moldura', () => {
  const user = (role: CurrentUser['role']): CurrentUser => ({ email: 'x', name: 'x', role, department: 'RH' });
  const labels = (role: CurrentUser['role']) => navItems(user(role), 0).map((s) => s.label);

  it('navegação segue o papel', () => {
    expect(labels('user')).toEqual(['Início', 'Biblioteca', 'Aprovações']);
    expect(labels('builder')).toEqual(['Início', 'Biblioteca', 'Aprovações', 'Meus apps']);
    expect(labels('admin')).toEqual(['Início', 'Biblioteca', 'Aprovações', 'Meus apps', 'Governança']);
  });

  it('aprovações pendentes viram contador; sem pendência, nada', () => {
    expect(navItems(user('user'), 2).find((i) => i.link === '/approvals')!.badge).toBe(2);
    expect(navItems(user('user'), 0).every((i) => i.badge === null)).toBeTrue();
  });

  it('só o Início exige rota exata', () => {
    expect(navItems(user('admin'), 0).filter((i) => i.exact).map((i) => i.link)).toEqual(['/']);
  });

  it('recolhe só no editor de um app', () => {
    expect(isToolRoute('/builder/abc')).toBeTrue();
    expect(isToolRoute('/builder')).toBeFalse();
    expect(isToolRoute('/builder?x=1')).toBeFalse();
    expect(isToolRoute('/run/abc')).toBeFalse();
  });

  it('usuário final (formulário e app publicado) não vê a barra; preview do rascunho vê', () => {
    expect(isBareRoute('/f/abc')).toBeTrue();
    expect(isBareRoute('/f-preview/abc')).toBeTrue();
    expect(isBareRoute('/run/abc?page=p1')).toBeTrue();
    expect(isBareRoute('/preview/abc')).toBeFalse();
    expect(isBareRoute('/runs')).toBeFalse();
  });

  it('tema alterna sistema → claro → escuro → sistema', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
