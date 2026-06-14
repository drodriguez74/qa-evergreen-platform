import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { getTransfer, type Receipt } from '../api';
import { formatMoney } from '../money';

export function ReceiptPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { session } = useAuth();

  // Prefer the receipt passed via navigation state; fall back to fetching by id.
  const initial = (location.state as Receipt | null) ?? null;
  const [receipt, setReceipt] = useState<Receipt | null>(initial);

  useEffect(() => {
    if (receipt || !params.id) return;
    let cancelled = false;
    getTransfer(session?.token ?? null, params.id)
      .then((r) => {
        if (!cancelled) setReceipt(r);
      })
      .catch(() => {
        /* leave null */
      });
    return () => {
      cancelled = true;
    };
  }, [receipt, params.id, session]);

  const transactionId = receipt?.transactionId ?? params.id ?? '';

  return (
    <main className="screen">
      <div className="card">
        <h1>Transfer Complete</h1>

        <p>Transaction ID: {transactionId}</p>
        {receipt && <p>New balance: {formatMoney(receipt.newBalance)}</p>}

        <div className="actions">
          <button type="button" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
