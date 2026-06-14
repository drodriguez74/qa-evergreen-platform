export interface LoginResponse {
  token: string;
  role: 'analyst' | 'supervisor';
  displayName: string;
  approvalLimit: number | null;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
}

export interface Payee {
  id: string;
  name: string;
}

export interface RecentActivity {
  id: string;
  date: string;
  payee: string;
  amount: number;
  from: string;
}

export interface TransferRequest {
  fromAccountId: string;
  payeeId: string;
  amount: number;
  memo?: string;
}

export interface Receipt {
  transactionId: string;
  status: 'completed';
  fromAccountId: string;
  payeeId: string;
  amount: number;
  memo?: string;
  newBalance: number;
}

export interface ApiError {
  code: string;
  message: string;
}

/** In-flight transfer carried from /transfer to /transfer/review. */
export interface PendingTransfer {
  fromAccountId: string;
  fromAccountName: string;
  payeeId: string;
  payeeName: string;
  amount: number;
  memo: string;
}
