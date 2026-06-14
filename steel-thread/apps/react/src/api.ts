// Single source of truth for the mock API base URL (per the a11y contract).
export const API_BASE_URL = 'http://localhost:4000';

export interface LoginResponse {
  token: string;
  role: 'analyst' | 'supervisor';
  displayName: string;
  approvalLimit?: number | null;
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

export interface ActivityItem {
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

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    // 401 -> invalid credentials (handled by caller).
    const err: ApiError = { code: 'UNAUTHORIZED', message: 'Invalid username or password' };
    throw err;
  }
  return (await res.json()) as LoginResponse;
}

export async function listAccounts(token: string | null): Promise<Account[]> {
  const res = await fetch(`${API_BASE_URL}/api/accounts`, {
    headers: { ...authHeaders(token) },
  });
  if (!res.ok) throw new Error('Failed to load accounts');
  return (await res.json()) as Account[];
}

export async function listPayees(token: string | null): Promise<Payee[]> {
  const res = await fetch(`${API_BASE_URL}/api/payees`, {
    headers: { ...authHeaders(token) },
  });
  if (!res.ok) throw new Error('Failed to load payees');
  return (await res.json()) as Payee[];
}

// Recent Activity has no dedicated path in openapi.yaml. The contract only
// requires the table (accessible name "Recent Activity") to exist, populated
// "from fixtures". We fetch it from /api/activity and degrade to an empty
// table if the endpoint is absent (404) so the contract surface is unaffected.
export async function listActivity(token: string | null): Promise<ActivityItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/activity`, {
      headers: { ...authHeaders(token) },
    });
    if (!res.ok) return [];
    return (await res.json()) as ActivityItem[];
  } catch {
    return [];
  }
}

export async function createTransfer(
  token: string | null,
  body: TransferRequest,
): Promise<{ ok: true; receipt: Receipt } | { ok: false; error: ApiError }> {
  const res = await fetch(`${API_BASE_URL}/api/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(body),
  });
  if (res.status === 201) {
    return { ok: true, receipt: (await res.json()) as Receipt };
  }
  // 422 business-rule rejection (or any non-201): surface the server message.
  let error: ApiError = { code: 'ERROR', message: 'Transfer failed' };
  try {
    error = (await res.json()) as ApiError;
  } catch {
    /* keep fallback */
  }
  return { ok: false, error };
}

export async function getTransfer(token: string | null, id: string): Promise<Receipt> {
  const res = await fetch(`${API_BASE_URL}/api/transfers/${encodeURIComponent(id)}`, {
    headers: { ...authHeaders(token) },
  });
  if (!res.ok) throw new Error('Receipt not found');
  return (await res.json()) as Receipt;
}
