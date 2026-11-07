import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth';
import { AppRunner } from './app-runner';
import { Api } from '../../core/api';
import { AppDefinition, PagedRecords, Props, RecordWriteResult } from '../../core/models';
import { PAGE_SIZE, TableBlock, toChart } from './data-blocks';
import { FormBlock } from './form-block';
import { RunContext } from './run-context';

// Jornada 2/3 (front): usuário preenche formulário gerado da tabela e o resultado do workflow é aplicado.

const definition: AppDefinition = {
  pages: [{ id: 'home', name: 'Início', components: [] }, { id: 'obrigado', name: 'Obrigado', components: [] }],
  tables: [{
    id: 'pedidos', name: 'Pedidos',
    fields: [
      { id: '1', name: 'Título', type: 'text', required: true, buildersOnly: false, readOnly: false, options: [], relationTableId: null },
      { id: '2', name: 'Prioridade', type: 'select', required: false, buildersOnly: false, readOnly: false, options: ['Baixa', 'Alta'], relationTableId: null },
      { id: '3', name: 'Custo interno', type: 'number', required: false, buildersOnly: true, readOnly: false, options: [], relationTableId: null },
    ],
    permissions: { userCanCreate: true, userCanEdit: false, userCanDelete: false },
    webhookKey: null,
  }],
  workflows: [],
};

class FakeApi {
  created: Props[] = [];
  queries: { q?: string; page?: number; size?: number }[] = [];
  labels = async () => [];
  app: (id: string) => Promise<unknown> = async () => null;
  queryRecords = async (_a: string, _e: string, _t: string, query: { q?: string; page?: number; size?: number }): Promise<PagedRecords> => {
    this.queries.push(query);
    return { items: [], total: 45, page: query.page ?? 1, size: query.size ?? 20, pages: 3 };
  };
  createRecord = async (_a: string, _e: string, _t: string, data: Props): Promise<RecordWriteResult> => {
    this.created.push(data);
    return { record: { id: 'r1', data, createdBy: '', createdAt: '', updatedBy: null, updatedAt: null }, workflow: { navigateTo: 'obrigado', log: ['E-mail enviado.'] } };
  };
}

describe('Runtime', () => {
  let api: FakeApi;
  let ctx: RunContext;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(), provideRouter([]), RunContext, { provide: Api, useValue: api },
        { provide: AuthService, useValue: { user: signal({ email: 'joao@corp.local', name: 'João', role: 'user', department: 'RH' }) } },
      ],
    });
    ctx = TestBed.inject(RunContext);
    ctx.appId.set('app');
    ctx.env.set('prod');
    ctx.definition.set(definition);
  });

  it('formulário gerado mostra apenas campos visíveis ao usuário', async () => {
    const fixture = TestBed.createComponent(FormBlock);
    fixture.componentRef.setInput('tableId', 'pedidos');
    await fixture.whenStable();
    const labels = [...fixture.nativeElement.querySelectorAll('label span')].map((e: Element) => e.textContent!.replace('*', '').trim());
    expect(labels).toEqual(['Título', 'Prioridade']);
  });

  it('salvar cria registro, aplica mensagem do workflow e navega', async () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(FormBlock);
    fixture.componentRef.setInput('tableId', 'pedidos');
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = 'Notebook';
    input.dispatchEvent(new Event('input'));
    await fixture.componentInstance.save();

    expect(api.created).toEqual([{ 'Título': 'Notebook' }]);
    expect(ctx.notice()?.text).toBe('Registro salvo. E-mail enviado.');
    expect(ctx.refresh()).toBe(1);
    expect(navigate).toHaveBeenCalledWith([], { queryParams: { page: 'obrigado' } });
  });

  it('erro da API vira aviso de erro', () => {
    ctx.fail({ error: { title: 'Sem permissão.' } });
    expect(ctx.notice()).toEqual({ text: 'Sem permissão.', error: true });
  });

  it('tabela consulta o servidor: busca só depois da pausa na digitação e volta para a página 1', async () => {
    const fixture = TestBed.createComponent(TableBlock);
    fixture.componentRef.setInput('tableId', 'pedidos');
    await fixture.whenStable();
    expect(api.queries.at(-1)).toEqual({ q: '', page: 1, size: PAGE_SIZE });

    const next = [...fixture.nativeElement.querySelectorAll('.pager button')].find((b: Element) => b.textContent!.includes('Próxima'));
    (next as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(api.queries.at(-1)).toEqual({ q: '', page: 2, size: PAGE_SIZE });

    const search: HTMLInputElement = fixture.nativeElement.querySelector('.table-tools input');
    for (const partial of ['so', 'sol', 'solic']) {
      search.value = partial;
      search.dispatchEvent(new Event('input'));
    }
    await new Promise((r) => setTimeout(r, 350));
    await fixture.whenStable();

    expect(api.queries.filter((q) => q.q && q.q !== 'solic')).toEqual([]); // nada de consulta por tecla
    expect(api.queries.at(-1)).toEqual({ q: 'solic', page: 1, size: PAGE_SIZE });
  });

  it('componentes e filhos de container somem quando a condição de visibilidade não é atendida', () => {
    ctx.canManage.set(false);
    const only = (field: string, value: string) => ({ field, op: 'eq' as const, value });
    expect(ctx.isVisible({ id: 'a', type: 'text', span: 12, props: {} })).toBeTrue();
    expect(ctx.isVisible({ id: 'b', type: 'text', span: 12, props: {}, visibleWhen: only('user.canManage', 'true') })).toBeFalse();
    expect(ctx.isVisible({ id: 'c', type: 'text', span: 12, props: {}, visibleWhen: only('user.department', 'rh') })).toBeTrue();

    ctx.setInput('tipo', 'Viagem');
    expect(ctx.isVisible({ id: 'd', type: 'container', span: 12, props: {}, children: [], visibleWhen: only('tipo', 'viagem') })).toBeTrue();
  });

  it('runner renderiza container com filhos e esconde o filho condicional', async () => {
    api.app = async () => ({
      id: 'app', name: 'App', slug: 's', draft: {
        pages: [{ id: 'home', name: 'Início', components: [{
          id: 'box', type: 'container', span: 12, props: { title: 'Bloco', variant: 'card' }, children: [
            { id: 't1', type: 'text', span: 6, props: { text: 'Para todos' } },
            { id: 't2', type: 'text', span: 6, props: { text: 'Só Financeiro' }, visibleWhen: { field: 'user.department', op: 'eq', value: 'Financeiro' } },
          ],
        }] }], tables: [], workflows: [],
      },
    });
    const fixture = TestBed.createComponent(AppRunner);
    fixture.componentRef.setInput('id', 'app');
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Bloco');
    expect(text).toContain('Para todos');
    expect(text).not.toContain('Só Financeiro');
  });

  it('gráfico mostra valores vazios como (vazio)', () => {
    expect(toChart([{ label: 'Alta', value: 2 }, { label: null, value: 1 }])).toEqual([
      { label: 'Alta', value: 2 }, { label: '(vazio)', value: 1 },
    ]);
  });
});
