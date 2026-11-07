import { HttpInterceptorFn } from '@angular/common/http';
import { Signal, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CurrentUser, FieldDef, TableDef } from '../models';

/**
 * PORTA DE AUTENTICAÇÃO do frontend. Implementação atual: DevAuthService (./dev-auth.ts).
 * No corporativo: crie uma classe que estenda esta usando a lib interna e troque o provider em app.config.ts.
 */
export abstract class AuthService {
  abstract readonly user: Signal<CurrentUser | null>;
  /** Executado no bootstrap (provideAppInitializer). */
  abstract init(): Promise<void>;
  /** Headers anexados a toda chamada à API (ex.: Authorization: Bearer ...). */
  abstract headers(): Record<string, string>;
}

export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: inject(AuthService).headers() }));

// ---------- RBAC (espelha AccessRules do backend; o backend é quem garante) ----------

export const isAdmin = (u: CurrentUser | null) => u?.role === 'admin';
export const canBuild = (u: CurrentUser | null) => u?.role === 'builder' || u?.role === 'admin';

export type TableOp = 'create' | 'edit' | 'delete';

export function canWrite(table: TableDef, op: TableOp, canManage: boolean): boolean {
  if (canManage) return true;
  const p = table.permissions;
  return op === 'create' ? p.userCanCreate : op === 'edit' ? p.userCanEdit : p.userCanDelete;
}

export function visibleFields(table: TableDef, canManage: boolean): FieldDef[] {
  return canManage ? table.fields : table.fields.filter((f) => !f.buildersOnly);
}

/** Campos que o usuário pode preencher (visíveis e não somente leitura). */
export function writableFields(table: TableDef, canManage: boolean): FieldDef[] {
  return canManage ? table.fields : table.fields.filter((f) => !f.buildersOnly && !f.readOnly);
}

export const builderGuard: CanActivateFn = () =>
  canBuild(inject(AuthService).user()) || inject(Router).parseUrl('/');

export const adminGuard: CanActivateFn = () =>
  isAdmin(inject(AuthService).user()) || inject(Router).parseUrl('/');
