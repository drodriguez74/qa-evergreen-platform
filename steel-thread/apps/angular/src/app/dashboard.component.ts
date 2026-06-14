import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { Account, RecentActivity } from './models';
import { formatMoney } from './money';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main>
      <div class="topbar">
        <h1>Dashboard</h1>

        <!--
          DELIBERATE ACCESSIBILITY DEFECT (required by the contract).
          Non-semantic menu toggle: a <div> with only a click handler and a
          glyph. No role, no aria-label, no keyboard handler => invisible to
          getByRole / keyboard users. Everything else on the page is semantic.
        -->
        <div class="menu-toggle" (click)="menuOpen = !menuOpen">☰</div>
      </div>

      @if (menuOpen) {
        <div class="menu-popover">Menu</div>
      }

      <p>Signed in as {{ displayName }}</p>

      <div class="card">
        <h2>Account Balances</h2>
        <table aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Balance</th>
            </tr>
          </thead>
          <tbody>
            @for (acct of accounts; track acct.id) {
              <tr>
                <td>{{ acct.name }}</td>
                <td>{{ format(acct.balance) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Recent Activity</h2>
        <table aria-label="Recent Activity">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Payee</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            @for (txn of recentActivity; track txn.id) {
              <tr>
                <td>{{ txn.date }}</td>
                <td>{{ txn.payee }}</td>
                <td>{{ format(txn.amount) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <button type="button" routerLink="/transfer">Initiate Transfer</button>
      <button type="button" class="secondary" (click)="signOut()">Sign out</button>
    </main>
  `,
})
export class DashboardComponent implements OnInit {
  displayName = '';
  accounts: Account[] = [];
  recentActivity: RecentActivity[] = [];
  menuOpen = false;
  readonly format = formatMoney;

  constructor(
    private readonly auth: AuthService,
    private readonly api: ApiService,
    private readonly http: HttpClient,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.displayName = this.auth.displayName;

    this.api.listAccounts().subscribe({
      next: (accts) => (this.accounts = accts),
      error: () => (this.accounts = []),
    });

    // Recent Activity has no dedicated API endpoint in the OpenAPI spec, so we
    // load it from the same fixtures.json the mock API seeds from, served as a
    // static asset (kept in sync, not hand-authored in component logic).
    this.http
      .get<{ recentActivity: RecentActivity[] }>('assets/fixtures.json')
      .subscribe({
        next: (data) => (this.recentActivity = data.recentActivity ?? []),
        error: () => (this.recentActivity = []),
      });
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
