// Posição de elementos flutuantes (tooltip) presos a uma âncora, sempre inteiros na tela (testado em placement.spec.ts).

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MARGIN = 8;
const GAP = 8;

/**
 * Lado preferido: à direita da âncora, alinhado pelo topo. Sem espaço à direita, vai para a esquerda; sem espaço
 * embaixo, alinha pela base da âncora (abre para cima). Em último caso, encosta na borda da tela (margem de 8 px).
 */
export function placeBeside(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }): { x: number; y: number } {
  let x = anchor.right + GAP;
  if (x + size.width > viewport.width - MARGIN) x = anchor.left - GAP - size.width;
  let y = anchor.top;
  if (y + size.height > viewport.height - MARGIN) y = anchor.bottom - size.height;
  return {
    x: clamp(x, MARGIN, viewport.width - MARGIN - size.width),
    y: clamp(y, MARGIN, viewport.height - MARGIN - size.height),
  };
}

/**
 * Menus (popover e menu de contexto): abaixo da âncora, alinhado à esquerda dela; sem espaço embaixo, abre para cima; sem
 * espaço à direita, alinha pela direita da âncora. Para o botão direito, a âncora é o ponto do clique (caixa de tamanho zero).
 */
export function placeBelow(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }): { x: number; y: number } {
  let x = anchor.left;
  if (x + size.width > viewport.width - MARGIN) x = anchor.right - size.width;
  let y = anchor.bottom + 4;
  if (y + size.height > viewport.height - MARGIN) y = anchor.top - 4 - size.height;
  return {
    x: clamp(x, MARGIN, viewport.width - MARGIN - size.width),
    y: clamp(y, MARGIN, viewport.height - MARGIN - size.height),
  };
}

/** Limita ao intervalo; se não couber nem assim (tela menor que o elemento), fica no mínimo. */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
