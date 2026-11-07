import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { Api } from '../../core/api';
import { AppDefinition, AppDetail } from '../../core/models';
import { LAYOUT } from '../../layout/layout';
import { UI } from '../../ui/ui';

/** Aba Compartilhar: link do formulário, quem pode responder (login por departamento ou link público) e automações ligadas. */
@Component({
  selector: 'app-form-share-tab',
  imports: [UI, LAYOUT],
  template: `
    <div class="settings">
      <app-section layout="aside" title="Link do formulário" description="Abre a versão publicada. Republicar não muda o link.">
        @if (app().publishedVersion) {
          <div class="webhook"><code>{{ url() }}</code></div>
          <div class="row">
            <button uiButton variant="primary" (click)="copy()">{{ copied() ? 'Link copiado' : 'Copiar link' }}</button>
            <a uiButton [href]="url()" target="_blank" rel="noopener">Abrir</a>
          </div>
        } @else {
          <app-empty title="Ainda não publicado" text="Publique no topo da tela para ativar o link." />
        }
      </app-section>

      <app-section layout="aside" title="Quem pode responder" description="Vale para a versão publicada: publique depois de mudar.">
        <ui-segmented label="Quem pode responder" [columns]="2" [options]="who" [value]="isPublic() ? 'public' : 'login'" (valueChange)="setPublic($event === 'public')" />
        <div style="margin-top: 14px">
          <ui-input label="Departamentos com login que podem responder" placeholder="Vazio = todos. Ex.: RH, TI" [value]="departments()"
            (valueChange)="departments.set($event)" />
        </div>
        @if (isPublic()) {
          <div class="callout" role="note">
            <strong>Link público: qualquer pessoa com o link responde, sem login.</strong>
            <span>Respostas sem login entram como “anonimo”. Quem tem login continua identificado.</span>
            <span>Peça consentimento (LGPD) nas boas-vindas e não pergunte dado sensível sem necessidade.</span>
            <span>Há limite de envios por hora e por endereço; o link só envia respostas, ninguém de fora vê dados.</span>
            <span>A governança pode desligar os links públicos da empresa toda.</span>
          </div>
        } @else {
          <p class="muted small">Só quem entra com o login da empresa, dos departamentos acima, responde. A resposta guarda quem respondeu.</p>
        }
      </app-section>

      <app-section layout="aside" title="Quando chegar resposta" description="Automações com o gatilho “Registro criado” na tabela de respostas.">
        <button actions uiButton (click)="openAutomations.emit()">Abrir automações</button>
        @for (w of onResponse(); track w.id) {
          <div class="version-row"><ui-icon name="recordCreated" /><span>{{ w.name }}</span></div>
        } @empty {
          <p class="muted small">Nenhuma ainda. Ex.: e-mail para o RH quando a nota for baixa, pedir aprovação, chamar uma API.</p>
        }
      </app-section>
    </div>
  `,
})
export class FormShareTab {
  readonly app = input.required<AppDetail>();
  readonly def = model.required<AppDefinition>();
  /** "RH, TI" (vazio = todos). */
  readonly departments = model('');
  readonly openAutomations = output<void>();
  private readonly api = inject(Api);

  protected readonly who = [{ value: 'login', label: 'Pessoas da empresa' }, { value: 'public', label: 'Qualquer pessoa com o link' }];
  protected readonly copied = signal(false);
  protected readonly url = computed(() => this.api.formUrl(this.app().slug));
  protected readonly isPublic = computed(() => !!this.def().form?.public);
  protected readonly onResponse = computed(() => {
    const tableId = this.def().form?.tableId;
    return this.def().workflows.filter((w) => w.trigger.type === 'recordCreated' && w.trigger.tableId === tableId);
  });

  protected setPublic(value: boolean) {
    const d = structuredClone(this.def());
    d.form!.public = value;
    this.def.set(d);
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false); // sem permissão de área de transferência: o link continua visível para copiar à mão
    }
  }
}
