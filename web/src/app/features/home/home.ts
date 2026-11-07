import { AppSummary, ComponentType } from '../../core/models';

// Regras puras da tela inicial (testadas em home.spec.ts).

export type ProjectKind = 'app' | 'form' | 'workflow';

export interface ProjectKindOption {
  kind: ProjectKind;
  label: string;
  text: string;
  icon: string;
  /** false = previsto no PRD, ainda não implementado. */
  ready: boolean;
}

/** Tipos de projeto que podem ser criados. Formulário: DOCS/PRD-FORMS.md. Workflow: DOCS/PRD-WORKFLOWS.md. */
export const PROJECT_KINDS: ProjectKindOption[] = [
  { kind: 'app', label: 'Mini app', icon: 'app', text: 'Páginas, banco de dados e automações.', ready: true },
  { kind: 'form', label: 'Formulário', icon: 'form', text: 'Uma pergunta por vez, com lógica e link.', ready: true },
  { kind: 'workflow', label: 'Workflow', icon: 'workflow', text: 'Automação em segundo plano, com histórico.', ready: true },
];

export const NEW_NAME: Record<ProjectKind, string> = { app: 'App sem título', form: 'Formulário sem título', workflow: 'Workflow sem título' };

/** Tipo do projeto (vem do backend, derivado da definição). */
export const kindOf = (a: Pick<AppSummary, 'kind'>): ProjectKind => a.kind ?? 'app';

/** Onde o usuário final abre o projeto publicado. */
export const runLink = (a: Pick<AppSummary, 'kind' | 'slug'>) => [kindOf(a) === 'form' ? '/f' : '/run', a.slug];

/** Projetos do tipo escolhido ('' = todos), mais recentes primeiro. */
export function recentProjects(apps: AppSummary[], kind: ProjectKind | '' = '', limit = Infinity): AppSummary[] {
  return apps
    .filter((a) => !kind || kindOf(a) === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export interface SketchBlock {
  type: ComponentType;
  span: number;
}

export const SKETCH_MAX = 8;

/** Miniatura: os primeiros componentes da 1ª página, com largura válida (1–12). */
export function sketchBlocks(sketch: SketchBlock[] | null | undefined): SketchBlock[] {
  return (sketch ?? []).slice(0, SKETCH_MAX).map((b) => ({ type: b.type, span: Math.min(12, Math.max(1, Math.round(b.span) || 12)) }));
}
