import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AuthService, authInterceptor } from './core/auth/auth';
import { DevAuthService } from './core/auth/dev-auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // [TROCA] AUTH: substitua DevAuthService pela implementação com a lib corporativa.
    { provide: AuthService, useClass: DevAuthService },
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
