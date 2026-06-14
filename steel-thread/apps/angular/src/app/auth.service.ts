import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { LoginResponse } from './models';

const STORAGE_KEY = 'fundflow.session';

interface Session {
  token: string;
  role: 'analyst' | 'supervisor';
  displayName: string;
  approvalLimit: number | null;
}

/**
 * Holds the authenticated session (token, role, displayName, approvalLimit).
 * Persisted to localStorage so a refresh keeps the user signed in.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<Session | null>(this.load());

  constructor(private readonly http: HttpClient) {}

  private load(): Session | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${API_BASE_URL}/api/login`, { username, password })
      .pipe(
        tap((res) => {
          const session: Session = {
            token: res.token,
            role: res.role,
            displayName: res.displayName,
            approvalLimit: res.approvalLimit,
          };
          this.session.set(session);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        })
      );
  }

  logout(): void {
    this.session.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  get token(): string | null {
    return this.session()?.token ?? null;
  }

  get displayName(): string {
    return this.session()?.displayName ?? '';
  }

  get role(): 'analyst' | 'supervisor' | null {
    return this.session()?.role ?? null;
  }

  get approvalLimit(): number | null {
    return this.session()?.approvalLimit ?? null;
  }

  get isAuthenticated(): boolean {
    return !!this.session()?.token;
  }
}
