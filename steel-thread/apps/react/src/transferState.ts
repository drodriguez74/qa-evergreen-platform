// Shape carried from /transfer -> /transfer/review (via router location state).
export interface PendingTransfer {
  fromAccountId: string;
  fromAccountName: string;
  payeeId: string;
  payeeName: string;
  amount: number;
  memo: string;
}
