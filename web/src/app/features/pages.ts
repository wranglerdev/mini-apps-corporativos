import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { AuthService, canBuild } from '../core/auth/auth';
import { Approval, AppSummary, AuditEntry, Workspace } from '../core/models';
import { LAYOUT, Notice } from '../layout/layout';
import { UI, UiRow } from '../ui/ui';
import { runLink } from './home/home';

async function attempt(notice: (n: Notice) => void, fn: () => Promise<unknown>, success?: string) {
  try {
    await fn();
    if (success) notice({ text: success, error: false });
  } catch (e) {
    notice({ text: errorMessage(e), error: true });
  }
}

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Biblioteca (antes "Catálogo"; ADR 0020): templates para começar um projeto (builders) e apps publicados pelas áreas e
 * liberados para o departamento. Builders podem usar um template ou clonar um app para o próprio workspace.
 */
@Component({
  selector: 'app-library-page',
  imports: [UI, LAYOUT, RouterLink],
  template: `
    <app-page [notice]="notice()">
      <app-page-header title="Biblioteca" subtitle="Templates para começar e apps publicados pelas áreas da empresa.">
        @if (builder() && workspaces().length > 1) {
          <div actions style="min-width: 240px">
            <ui-select label="Criar em" [options]="wsOptions()" [(value)]="target" />
          </div>
        }
      </app-page-header>

      @if (builder()) {
        <app-section title="Templates" description="Modelos prontos compartilhados entre as áreas. Cria uma cópia editável no seu workspace.">
          <div class="tiles">
            @for (t of templates(); track t.id) {
              <div class="tile">
                <strong class="tile__name">{{ t.name }}</strong>
                <p class="tile__text">{{ t.description }}</p>
                <button uiButton (click)="useTemplate(t)" [disabled]="!target()">Usar template</button>
              </div>
            } @empty {
              <app-empty title="Nenhum template ainda" text="Marque um projeto como template na aba Publicação do editor para ele aparecer aqui." />
            }
          </div>
        </app-section>
      }

      <app-section [title]="apps().length + (apps().length === 1 ? ' app publicado' : ' apps publicados')"
        description="Liberados para o seu departamento.">
        <div class="index">
          @for (a of apps(); track a.id) {
            <div class="index__row">
              <div>
                <a class="index__name" [routerLink]="link(a)">{{ a.name }}</a>
                <div class="index__meta">
                  <span class="muted small">{{ a.description }}</span>
                  @if (a.kind === 'form') { <span class="chip">Formulário</span> }
                  <span class="chip">versão {{ a.publishedVersion }}</span>
                </div>
              </div>
              <div class="index__actions">
                @if (builder() && target()) {
                  <button uiButton variant="ghost" (click)="clone(a)">Clonar</button>
                }
                <a uiButton variant="primary" [routerLink]="link(a)">Abrir</a>
              </div>
            </div>
          } @empty {
            <app-empty title="Nenhum app liberado para você ainda" text="Quando uma área publicar um app para o seu departamento, ele aparece aqui." />
          }
        </div>
      </app-section>
    </app-page>
  `,
})
export class LibraryPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly user = inject(AuthService).user;
  protected readonly builder = computed(() => canBuild(this.user()));
  protected readonly apps = signal<AppSummary[]>([]);
  protected readonly templates = signal<AppSummary[]>([]);
  protected readonly workspaces = signal<Workspace[]>([]);
  protected readonly target = signal('');
  protected readonly notice = signal<Notice>(null);
  protected readonly wsOptions = computed(() => this.workspaces().map((w) => ({ value: w.id, label: w.name })));

  constructor() {
    attempt(this.notice.set, async () => {
      this.apps.set(await this.api.catalog());
      if (this.builder()) {
        const [templates, workspaces] = await Promise.all([this.api.templates(), this.api.workspaces()]);
        this.templates.set(templates);
        this.workspaces.set(workspaces);
        this.target.set(this.workspaces()[0]?.id ?? '');
      }
    });
  }

  protected link = runLink;

  /** Cria a cópia do template no workspace escolhido e abre o editor. */
  protected useTemplate(t: AppSummary) {
    return attempt(this.notice.set, async () => {
      const app = await this.api.createApp(this.target(), t.name, t.id, t.kind);
      this.router.navigate(['/builder', app.id]);
    });
  }

  protected clone(a: AppSummary) {
    return attempt(this.notice.set, () => this.api.duplicate(a.id, this.target()), `Cópia de "${a.name}" criada em Meus apps.`);
  }
}

/** Caixa de aprovações: decidir pendências e acompanhar o histórico. */
@Component({
  selector: 'app-approvals-page',
  imports: [UI, LAYOUT],
  template: `
    <app-page [notice]="notice()">
      <app-page-header title="Aprovações" subtitle="Pedidos que dependem da sua decisão e o andamento dos que você enviou." />

      <app-section [title]="'Aguardando você' + (toDecide().length ? ' (' + toDecide().length + ')' : '')">
        @for (a of toDecide(); track a.id) {
          <div class="approval">
            <div>
              <h3>{{ a.title }}</h3>
              <p class="muted small">Enviado por {{ a.requestedBy }} em {{ date(a.createdAt) }}</p>
            </div>
            <ui-input placeholder="Comentário (opcional)" [value]="comments()[a.id] ?? ''" (valueChange)="comment(a.id, $event)" />
            <div class="row">
              <button uiButton variant="danger" (click)="decide(a, false)">Rejeitar</button>
              <button uiButton variant="primary" (click)="decide(a, true)">Aprovar</button>
            </div>
          </div>
        } @empty {
          <app-empty title="Nada esperando sua decisão" text="Pedidos endereçados a você aparecem aqui e também chegam por e-mail." />
        }
      </app-section>

      <app-section title="Histórico" description="Tudo o que você pediu ou decidiu.">
        <ui-table [columns]="columns" [rows]="history()" empty="Nenhuma aprovação ainda." />
      </app-section>
    </app-page>
  `,
})
export class ApprovalsPage {
  private readonly api = inject(Api);
  private readonly me = inject(AuthService).user;
  protected readonly date = date;
  protected readonly items = signal<Approval[]>([]);
  protected readonly comments = signal<Partial<Record<string, string>>>({});
  protected readonly notice = signal<Notice>(null);

  protected readonly toDecide = computed(() => this.items().filter((a) => a.status === 'pending' && a.approver === this.me()?.email));
  protected readonly columns = [
    { key: 'title', label: 'Pedido' }, { key: 'requestedBy', label: 'Solicitante' }, { key: 'approver', label: 'Aprovador' },
    { key: 'when', label: 'Data' }, { key: 'status', label: 'Status' }, { key: 'comment', label: 'Comentário' },
  ];
  protected readonly history = computed<UiRow[]>(() =>
    this.items().map((a) => ({
      id: a.id,
      cells: {
        title: a.title, requestedBy: a.requestedBy, approver: a.approver, when: date(a.decidedAt ?? a.createdAt),
        status: STATUS[a.status], comment: a.comment ?? '',
      },
    })),
  );

  constructor() {
    this.load();
  }

  protected comment(id: string, text: string) {
    this.comments.update((c) => ({ ...c, [id]: text }));
  }

  protected decide(a: Approval, approve: boolean) {
    return attempt(this.notice.set, async () => {
      await this.api.decide(a.id, approve, this.comments()[a.id] ?? '');
      await this.load();
    }, `"${a.title}" ${approve ? 'aprovado' : 'rejeitado'}. O solicitante foi avisado por e-mail.`);
  }

  private load() {
    return attempt(this.notice.set, async () => this.items.set(await this.api.approvals()));
  }
}

const STATUS = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' } as const;
const AUDIT_PAGE = 25;

/** Governança central: workspaces por unidade e log de auditoria. */
@Component({
  selector: 'app-admin-page',
  imports: [UI, LAYOUT],
  template: `
    <app-page [notice]="notice()">
      <app-page-header title="Governança" subtitle="Unidades com espaço próprio para criar apps e o registro de tudo o que foi feito." />

      <div class="columns">
        <app-section title="Auditoria" [description]="'Últimos ' + audit().length + ' eventos, do mais recente para o mais antigo.'">
          <ui-table [columns]="columns" [rows]="rows()" />
          @if (shown() < audit().length) {
            <div class="row end" style="margin-top: 12px">
              <button uiButton variant="ghost" (click)="shown.set(shown() + AUDIT_PAGE)">Mostrar mais</button>
            </div>
          }
        </app-section>

        <app-section title="Workspaces" description="Builders criam apps nos workspaces do próprio departamento.">
          @for (w of workspaces(); track w.id) {
            <div class="row" style="padding: 8px 0; border-bottom: 1px solid var(--rule-soft)">
              <span>{{ w.name }}</span><span class="spacer"></span><span class="chip">{{ w.department }}</span>
            </div>
          }
          <div style="margin-top: 18px">
            <ui-input label="Nome do workspace" placeholder="Ex.: Jurídico" [(value)]="wsName" />
            <ui-input label="Departamento" placeholder="Igual ao do usuário no SSO" [(value)]="wsDept" />
            <button uiButton variant="primary" (click)="createWorkspace()" [disabled]="!wsName() || !wsDept()">Criar workspace</button>
          </div>
        </app-section>
      </div>
    </app-page>
  `,
})
export class AdminPage {
  private readonly api = inject(Api);
  protected readonly AUDIT_PAGE = AUDIT_PAGE;
  protected readonly workspaces = signal<Workspace[]>([]);
  protected readonly audit = signal<AuditEntry[]>([]);
  protected readonly shown = signal(AUDIT_PAGE);
  protected readonly wsName = signal('');
  protected readonly wsDept = signal('');
  protected readonly notice = signal<Notice>(null);
  protected readonly columns = [
    { key: 'at', label: 'Quando' }, { key: 'user', label: 'Quem' }, { key: 'action', label: 'Ação' },
    { key: 'entity', label: 'Objeto' }, { key: 'details', label: 'Detalhes' },
  ];
  protected readonly rows = computed<UiRow[]>(() =>
    this.audit().slice(0, this.shown()).map((a) => ({
      id: String(a.id),
      cells: { at: dateTime(a.at), user: a.user, action: AUDIT_LABEL[a.action] ?? a.action, entity: ENTITY_LABEL[a.entity] ?? a.entity, details: a.details ?? '' },
    })),
  );

  constructor() {
    this.load();
  }

  protected createWorkspace() {
    return attempt(this.notice.set, async () => {
      await this.api.createWorkspace(this.wsName(), this.wsDept());
      this.wsName.set('');
      this.wsDept.set('');
      await this.load();
    }, 'Workspace criado.');
  }

  private load() {
    return attempt(this.notice.set, async () => {
      const [ws, audit] = await Promise.all([this.api.workspaces(), this.api.audit()]);
      this.workspaces.set(ws);
      this.audit.set(audit);
    });
  }
}

const ENTITY_LABEL: Partial<Record<string, string>> = { app: 'App', workflow: 'Automação', approval: 'Aprovação', file: 'Arquivo', workspace: 'Workspace' };

const AUDIT_LABEL: Partial<Record<string, string>> = {
  'app.create': 'Criou app', 'app.update': 'Editou app', 'app.publish': 'Publicou app', 'app.rollback': 'Restaurou versão',
  'app.duplicate': 'Duplicou app', 'app.delete': 'Excluiu app', 'app.access': 'Abriu app', 'record.create': 'Criou registro',
  'record.update': 'Editou registro', 'record.delete': 'Excluiu registro', 'record.import': 'Importou planilha',
  'record.export': 'Exportou', 'record.webhook': 'Recebeu webhook', 'workflow.run': 'Rodou automação',
  'workflow.chain-limit': 'Cadeia interrompida', 'workflow.error': 'Erro em automação', 'approval.decide': 'Decidiu aprovação',
  'file.upload': 'Enviou arquivo', 'workspace.create': 'Criou workspace',
};
