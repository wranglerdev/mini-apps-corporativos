import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { SecretInfo, Workspace } from '../../core/models';
import { LAYOUT, Notice } from '../../layout/layout';
import { UI, UiRow } from '../../ui/ui';

/** Aba Segredos: tokens do workspace usados como {{secrets.NOME}}. O valor só entra; nunca volta para a tela. */
@Component({
  selector: 'app-secrets-tab',
  imports: [UI, LAYOUT],
  template: `
    <div class="settings">
      @if (notice(); as n) { <ui-notice [error]="n.error">{{ n.text }}</ui-notice> }
      <app-section layout="aside" [title]="'Segredos do workspace ' + (workspace()?.name ?? '')"
        [description]="'Valem para todos os projetos do workspace. Use ' + syntax + ' em URL, cabeçalhos e corpo. Depois de salvo, o valor não aparece de novo (nem nas execuções).'">
        <ui-table [columns]="columns" [rows]="rows()" empty="Nenhum segredo ainda.">
          <ng-template let-id>
            <button uiButton variant="danger" (click)="remove(id)">{{ confirm() === id ? 'Confirmar' : 'Remover' }}</button>
          </ng-template>
        </ui-table>
      </app-section>

      <app-section layout="aside" title="Novo segredo ou trocar valor" description="Mesmo nome substitui o valor. Só quem gerencia o workspace vê esta aba.">
        <div class="form-row">
          <ui-input label="Nome" placeholder="ERP_TOKEN" [(value)]="name" />
          <ui-input label="Valor" type="password" placeholder="Cole o token aqui" [(value)]="value" />
        </div>
        <button uiButton variant="primary" [disabled]="!name() || !value()" (click)="saveSecret()">Salvar segredo</button>
        <p class="muted small">Letras maiúsculas, números e _. Fica cifrado no banco (no corporativo: cofre de senhas).</p>
      </app-section>
    </div>
  `,
})
export class SecretsTab {
  readonly workspaceId = input.required<string>();
  private readonly api = inject(Api);

  protected readonly syntax = '{{secrets.NOME}}';
  protected readonly secrets = signal<SecretInfo[]>([]);
  protected readonly workspace = signal<Workspace | null>(null);
  protected readonly name = signal('');
  protected readonly value = signal('');
  protected readonly confirm = signal<string | null>(null);
  protected readonly notice = signal<Notice>(null);
  protected readonly columns = [{ key: 'name', label: 'Nome' }, { key: 'value', label: 'Valor' }, { key: 'updated', label: 'Atualizado' }];
  protected readonly rows = computed<UiRow[]>(() => this.secrets().map((s) => ({
    id: s.name,
    cells: { name: s.name, value: '••••••••', updated: `${s.updatedBy}, ${new Date(s.updatedAt).toLocaleDateString('pt-BR')}` },
  })));

  constructor() {
    effect(() => {
      const id = this.workspaceId();
      untracked(() => this.load(id));
    });
  }

  protected saveSecret() {
    return this.attempt(async () => {
      await this.api.setSecret(this.workspaceId(), this.name().trim(), this.value());
      this.notice.set({ text: `Segredo ${this.name().trim()} salvo.`, error: false });
      this.name.set('');
      this.value.set('');
      await this.load(this.workspaceId());
    });
  }

  protected remove(name: string) {
    if (this.confirm() !== name) return this.confirm.set(name);
    return this.attempt(async () => {
      await this.api.deleteSecret(this.workspaceId(), name);
      this.confirm.set(null);
      await this.load(this.workspaceId());
    });
  }

  private load(id: string) {
    return this.attempt(async () => {
      const [secrets, workspaces] = await Promise.all([this.api.secrets(id), this.api.workspaces()]);
      this.secrets.set(secrets);
      this.workspace.set(workspaces.find((w) => w.id === id) ?? null);
    });
  }

  private async attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      this.notice.set({ text: errorMessage(e), error: true });
    }
  }
}
