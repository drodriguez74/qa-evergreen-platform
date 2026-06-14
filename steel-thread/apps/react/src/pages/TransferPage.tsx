import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { listAccounts, listPayees, type Account, type Payee } from '../api';
import type { PendingTransfer } from '../transferState';

const ANALYST_APPROVAL_LIMIT = 10000;

export function TransferPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();

  // Values preserved when coming Back from the review screen.
  const preserved = (location.state as Partial<PendingTransfer> | null) ?? null;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [fromAccountId, setFromAccountId] = useState(preserved?.fromAccountId ?? '');
  const [payeeId, setPayeeId] = useState(preserved?.payeeId ?? '');
  const [amount, setAmount] = useState(
    preserved?.amount != null ? String(preserved.amount) : '',
  );
  const [memo, setMemo] = useState(preserved?.memo ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = session?.token ?? null;
    Promise.all([listAccounts(token), listPayees(token)])
      .then(([acc, pay]) => {
        if (cancelled) return;
        setAccounts(acc);
        setPayees(pay);
        // Default selections to the first option so a combobox always has a value.
        setFromAccountId((prev) => prev || acc[0]?.id || '');
        setPayeeId((prev) => prev || pay[0]?.id || '');
      })
      .catch(() => {
        /* leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const numeric = Number(amount);
    // 1. empty / zero / non-numeric amount
    if (amount.trim() === '' || Number.isNaN(numeric) || numeric <= 0) {
      setError('Enter a valid amount greater than zero');
      return;
    }

    const account = accounts.find((a) => a.id === fromAccountId);
    // 2. amount > selected account balance
    if (account && numeric > account.balance) {
      setError('Amount exceeds available balance');
      return;
    }

    // 3. analyst only: amount > $10,000 (supervisor never sees this)
    if (session?.role === 'analyst' && numeric > ANALYST_APPROVAL_LIMIT) {
      setError('Amount exceeds your approval limit of $10,000');
      return;
    }

    const payee = payees.find((p) => p.id === payeeId);
    const pending: PendingTransfer = {
      fromAccountId,
      fromAccountName: account?.name ?? '',
      payeeId,
      payeeName: payee?.name ?? '',
      amount: numeric,
      memo: memo.trim(),
    };
    navigate('/transfer/review', { state: pending });
  }

  return (
    <main className="screen">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <h1>Initiate Transfer</h1>

        <div className="field">
          <label htmlFor="fromAccount">From account</label>
          <select
            id="fromAccount"
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
          >
            {accounts.map((acct) => (
              <option key={acct.id} value={acct.id}>
                {acct.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="payee">Payee</label>
          <select id="payee" value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
            {payees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="amount">Amount</label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="memo">Memo</label>
          <input
            id="memo"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit">Continue to review</button>
      </form>
    </main>
  );
}
