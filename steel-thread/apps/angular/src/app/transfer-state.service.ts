import { Injectable } from '@angular/core';
import { PendingTransfer } from './models';

/**
 * Carries the in-flight transfer from /transfer to /transfer/review and
 * preserves it when the user goes Back. Lives for the lifetime of the SPA
 * session (not persisted) — a fresh review with no pending transfer should
 * bounce the user back to /transfer.
 */
@Injectable({ providedIn: 'root' })
export class TransferStateService {
  private pending: PendingTransfer | null = null;

  set(transfer: PendingTransfer): void {
    this.pending = transfer;
  }

  get(): PendingTransfer | null {
    return this.pending;
  }

  clear(): void {
    this.pending = null;
  }
}
