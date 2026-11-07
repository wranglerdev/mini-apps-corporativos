import { Routes } from '@angular/router';
import { adminGuard, builderGuard } from './core/auth/auth';
import { HomePage } from './features/home/home-page';
import { AdminPage, ApprovalsPage, CatalogPage } from './features/pages';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Início' },
  { path: 'catalog', component: CatalogPage, title: 'Catálogo' },
  { path: 'approvals', component: ApprovalsPage, title: 'Aprovações' },
  // Modo usuário (produção) e preview do rascunho
  { path: 'run/:slug', loadComponent: () => import('./features/runtime/app-runner').then((m) => m.AppRunner) },
  { path: 'preview/:id', canActivate: [builderGuard], loadComponent: () => import('./features/runtime/app-runner').then((m) => m.AppRunner) },
  // Formulários: responder (publicado, pode ser link público) e testar o rascunho
  { path: 'f/:slug', title: 'Formulário', loadComponent: () => import('./features/forms/form-runner').then((m) => m.FormRunner) },
  { path: 'f-preview/:id', canActivate: [builderGuard], title: 'Teste do formulário', loadComponent: () => import('./features/forms/form-runner').then((m) => m.FormRunner) },
  // Modo builder
  { path: 'builder', canActivate: [builderGuard], loadComponent: () => import('./features/builder/apps-page').then((m) => m.AppsPage) },
  { path: 'builder/:id', canActivate: [builderGuard], loadComponent: () => import('./features/builder/editor-page').then((m) => m.EditorPage) },
  { path: 'admin', component: AdminPage, canActivate: [adminGuard], title: 'Admin' },
  { path: '**', redirectTo: '' },
];
