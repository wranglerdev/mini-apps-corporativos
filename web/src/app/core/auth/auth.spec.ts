import { CurrentUser, TableDef } from '../models';
import { canBuild, canWrite, isAdmin, visibleFields, writableFields } from './auth';

// RBAC no front (só para esconder UI; o backend é quem garante).
describe('RBAC', () => {
  const user = (role: CurrentUser['role']): CurrentUser => ({ email: 'x', name: 'x', role, department: 'RH' });
  const table: TableDef = {
    id: 't', name: 'T',
    fields: [
      { id: '1', name: 'Público', type: 'text', required: false, buildersOnly: false, readOnly: false, options: [], relationTableId: null },
      { id: '2', name: 'Interno', type: 'text', required: false, buildersOnly: true, readOnly: false, options: [], relationTableId: null },
      { id: '3', name: 'Status', type: 'text', required: false, buildersOnly: false, readOnly: true, options: [], relationTableId: null },
    ],
    permissions: { userCanCreate: true, userCanEdit: false, userCanDelete: false },
    webhookKey: null,
  };

  it('papéis', () => {
    expect(canBuild(user('user'))).toBeFalse();
    expect(canBuild(user('builder'))).toBeTrue();
    expect(isAdmin(user('builder'))).toBeFalse();
    expect(isAdmin(user('admin'))).toBeTrue();
  });

  it('permissões de tabela valem só para quem não gerencia o app', () => {
    expect(canWrite(table, 'create', false)).toBeTrue();
    expect(canWrite(table, 'edit', false)).toBeFalse();
    expect(canWrite(table, 'delete', true)).toBeTrue();
  });

  it('campos só-builders ficam ocultos para usuários', () => {
    expect(visibleFields(table, false).map((f) => f.name)).toEqual(['Público', 'Status']);
    expect(visibleFields(table, true).length).toBe(3);
  });

  it('campos só leitura aparecem mas não entram no formulário do usuário', () => {
    expect(writableFields(table, false).map((f) => f.name)).toEqual(['Público']);
    expect(writableFields(table, true).length).toBe(3);
  });
});
