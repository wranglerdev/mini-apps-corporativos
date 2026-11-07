import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CurrentUser } from '../models';
import { AuthService } from './auth';

/**
 * ADAPTADOR DE AUTH de desenvolvimento: pergunta ao backend quem está logado (/api/me).
 * O usuário é definido em mock-auth.json na raiz — não há troca pela UI.
 * [TROCA] No corporativo, substitua por uma implementação com a lib interna (ver app.config.ts).
 */
@Injectable()
export class DevAuthService extends AuthService {
  private readonly http = inject(HttpClient);
  private readonly current = signal<CurrentUser | null>(null);
  readonly user = this.current.asReadonly();

  /** Sem login (ex.: link público de formulário) o app sobe como anônimo: user = null. */
  async init() {
    try {
      this.current.set(await firstValueFrom(this.http.get<CurrentUser>('/api/me')));
    } catch {
      this.current.set(null);
    }
  }

  headers(): Record<string, string> {
    return {};
  }
}
