import { isInternal, isSafeLink, prefillFrom } from './links';

// Jornada 8 (front): abrir outro projeto ou link e chegar com valores pré-preenchidos.
describe('Links entre projetos', () => {
  it('só abre caminho do site ou http(s)', () => {
    expect(isInternal('/f/pesquisa?Nome=Ana')).toBeTrue();
    expect(isInternal('//evil.com')).toBeFalse();
    expect(isSafeLink('https://intranet.corp.local')).toBeTrue();
    expect(isSafeLink('javascript:alert(1)')).toBeFalse();
    expect(isSafeLink(null)).toBeFalse();
  });

  it('pré-preenche só nomes conhecidos, sem diferenciar maiúsculas', () => {
    expect(prefillFrom({ nome: 'Ana', page: 'p2', 'E-mail': 'a@b.c', Outro: 'x' }, ['Nome', 'E-mail'])).toEqual({ Nome: 'Ana', 'E-mail': 'a@b.c' });
  });
});
