import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { TransferStateService } from './transfer-state.service';
import { Account, Payee } from './models';

const ANALYST_LIMIT = 10000;

@Component({
  selector: 'app-transfer',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main>
      <h1>Initiate Transfer</h1>
      <div class="card">
        <form (ngSubmit)="continueToReview()">
          <label for="fromAccount">From account</label>
          <select id="fromAccount" name="fromAccount" [(ngModel)]="fromAccountId">
            <option value="">Select an account</option>
            @for (acct of accounts; track acct.id) {
              <option [value]="acct.id">{{ acct.name }}</option>
            }
          </select>

          <label for="payee">Payee</label>
          <select id="payee" name="payee" [(ngModel)]="payeeId">
            <option value="">Select a payee</option>
            @for (p of payees; track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
            }
          </select>

          <label for="amount">Amount</label>
          <input
            id="amount"
            name="amount"
            type="text"
            inputmode="decimal"
            [(ngModel)]="amount"
          />

          <label for="memo">Memo</label>
          <input id="memo" name="memo" type="text" [(ngModel)]="memo" />

          @if (error) {
            <div role="alert">{{ error }}</div>
          }

          <button type="submit">Continue to review</button>
        </form>
      </div>
    </main>
  `,
})
export class TransferComponent implements OnInit {
  accounts: Account[] = [];
  payees: Payee[] = [];

  fromAccountId = '';
  payeeId = '';
  amount = '';
  memo = '';
  error = '';

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly state: TransferStateService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.api.listAccounts().subscribe({
      next: (a) => (this.accounts = a),
      error: () => (this.accounts = []),
    });
    this.api.listPayees().subscribe({
      next: (p) => (this.payees = p),
      error: () => (this.payees = []),
    });

    // Restore values if the user came Back from review.
    const pending = this.state.get();
    if (pending) {
      this.fromAccountId = pending.fromAccountId;
      this.payeeId = pending.payeeId;
      this.amount = String(pending.amount);
      this.memo = pending.memo;
    }
  }

  continueToReview(): void {
    this.error = '';
    const raw = this.amount.trim();
    const amount = Number(raw);

    // 1) empty / zero / non-numeric amount.
    if (raw === '' || !Number.isFinite(amount) || amount <= 0) {
      this.error = 'Enter a valid amount greater than zero';
      return;
    }

    const account = this.accounts.find((a) => a.id === this.fromAccountId);

    // 2) amount > selected account balance.
    if (account && amount > account.balance) {
      this.error = 'Amount exceeds available balance';
      return;
    }

    // 3) analyst only: amount > $10,000. Supervisor is exempt.
    if (this.auth.role === 'analyst' && amount > ANALYST_LIMIT) {
      this.error = 'Amount exceeds your approval limit of $10,000';
      return;
    }

    const payee = this.payees.find((p) => p.id === this.payeeId);
    this.state.set({
      fromAccountId: this.fromAccountId,
      fromAccountName: account ? account.name : this.fromAccountId,
      payeeId: this.payeeId,
      payeeName: payee ? payee.name : this.payeeId,
      amount,
      memo: this.memo.trim(),
    });

    this.router.navigate(['/transfer/review']);
  }
}
