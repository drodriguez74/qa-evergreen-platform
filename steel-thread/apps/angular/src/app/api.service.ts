import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { AuthService } from './auth.service';
import { Account, Payee, Receipt, TransferRequest } from './models';

/**
 * Authenticated calls to the FundFlow API. Each request attaches the bearer
 * token from AuthService.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.auth.token ?? ''}` });
  }

  listAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>(`${API_BASE_URL}/api/accounts`, {
      headers: this.authHeaders(),
    });
  }

  listPayees(): Observable<Payee[]> {
    return this.http.get<Payee[]>(`${API_BASE_URL}/api/payees`, {
      headers: this.authHeaders(),
    });
  }

  createTransfer(body: TransferRequest): Observable<Receipt> {
    return this.http.post<Receipt>(`${API_BASE_URL}/api/transfers`, body, {
      headers: this.authHeaders(),
    });
  }

  getReceipt(id: string): Observable<Receipt> {
    return this.http.get<Receipt>(`${API_BASE_URL}/api/transfers/${id}`, {
      headers: this.authHeaders(),
    });
  }
}
