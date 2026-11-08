import { placeBelow, placeBeside } from './placement';

// Jornada 7 (front): o tooltip das variáveis aparece inteiro, qualquer que seja o scroll.
describe('Posição do tooltip', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 260, height: 200 };
  const anchor = (left: number, top: number) => ({ left, top, right: left + 200, bottom: top + 24 });

  it('com espaço, fica à direita da âncora, alinhado pelo topo', () => {
    expect(placeBeside(anchor(60, 100), size, viewport)).toEqual({ x: 268, y: 100 });
  });

  it('no fim da tela abre para cima (alinha pela base da âncora)', () => {
    expect(placeBeside(anchor(60, 700), size, viewport)).toEqual({ x: 268, y: 524 });
  });

  it('sem espaço à direita, vai para a esquerda', () => {
    expect(placeBeside(anchor(700, 100), size, viewport)).toEqual({ x: 432, y: 100 });
  });

  it('âncora meio fora da tela (scroll): encosta na borda em vez de cortar', () => {
    expect(placeBeside(anchor(60, -20), size, viewport)).toEqual({ x: 268, y: 8 });
    expect(placeBeside(anchor(60, 790), size, viewport)).toEqual({ x: 268, y: 592 });
    // tela estreita: nem direita nem esquerda cabem
    expect(placeBeside(anchor(40, 100), size, { width: 390, height: 800 })).toEqual({ x: 8, y: 100 });
  });

  it('menu abre abaixo e alinhado à esquerda; no canto, vira para cima e para a esquerda', () => {
    const menu = { width: 200, height: 160 };
    const point = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y });
    expect(placeBelow(point(100, 100), menu, viewport)).toEqual({ x: 100, y: 104 });
    expect(placeBelow(point(950, 780), menu, viewport)).toEqual({ x: 750, y: 616 });
    // botão de 3 pontos colado na direita: alinha pela direita do botão
    expect(placeBelow({ left: 960, top: 10, right: 984, bottom: 34 }, menu, viewport)).toEqual({ x: 784, y: 38 });
  });
});
