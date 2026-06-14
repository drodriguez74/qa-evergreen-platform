import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from './api.service';
import { Receipt } from './models';
import { formatMoney } from './money';

@Component({
  selector: 'app-receipt',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main>
      <h1>Transfer Complete</h1>
      <div class="card summary">
        @if (receipt) {
          <p>Transaction ID: {{ receipt.transactionId }}</p>
          <p>New balance: {{ format(receipt.newBalance) }}</p>
        }
        <button type="button" routerLink="/dashboard">Back to dashboard</button>
      </div>
    </main>
  `,
})
export class ReceiptComponent implements OnInit {
  receipt: Receipt | null = null;
  readonly format = formatMoney;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.getReceipt(id).subscribe({
        next: (r) => (this.receipt = r),
        error: () => (this.receipt = null),
      });
    }
  }
}
