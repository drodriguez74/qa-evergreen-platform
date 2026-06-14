import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { TransferStateService } from './transfer-state.service';
import { PendingTransfer, ApiError } from './models';
import { formatMoney } from './money';

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [],
  template: `
    <main>
      <h1>Review &amp; Confirm</h1>
      @if (pending) {
        <div class="card summary">
          <p>From: {{ pending.fromAccountName }}</p>
          <p>Payee: {{ pending.payeeName }}</p>
          <p>Amount: {{ format(pending.amount) }}</p>
          <p>Memo: {{ pending.memo || '—' }}</p>

          @if (error) {
            <div role="alert">{{ error }}</div>
          }

          <button type="button" (click)="confirm()" [disabled]="submitting">
            Confirm transfer
          </button>
          <button type="button" class="secondary" (click)="back()">Back</button>
        </div>
      }
    </main>
  `,
})
export class ReviewComponent implements OnInit {
  pending: PendingTransfer | null = null;
  error = '';
  submitting = false;
  readonly format = formatMoney;

  constructor(
    private readonly api: ApiService,
    private readonly state: TransferStateService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.pending = this.state.get();
    // Landing on review with nothing to confirm: send back to the form.
    if (!this.pending) {
      this.router.navigate(['/transfer']);
    }
  }

  confirm(): void {
    if (!this.pending) {
      return;
    }
    this.error = '';
    this.submitting = true;
    this.api
      .createTransfer({
        fromAccountId: this.pending.fromAccountId,
        payeeId: this.pending.payeeId,
        amount: this.pending.amount,
        memo: this.pending.memo,
      })
      .subscribe({
        next: (receipt) => {
          this.submitting = false;
          this.state.clear();
          this.router.navigate(['/transfer/receipt', receipt.transactionId]);
        },
        error: (err) => {
          this.submitting = false;
          // 422: surface the server's message verbatim in a role="alert".
          const body = err?.error as ApiError | undefined;
          this.error = body?.message ?? 'Transfer could not be completed';
        },
      });
  }

  back(): void {
    // Values are preserved in TransferStateService; the form restores them.
    this.router.navigate(['/transfer']);
  }
}
