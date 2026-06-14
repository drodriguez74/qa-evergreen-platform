import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { createTransfer } from '../api';
import { formatMoney } from '../money';
import type { PendingTransfer } from '../transferState';

export function ReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const pending = (location.state as PendingTransfer | null) ?? null;

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // No transfer in flight (e.g. direct navigation) -> back to the form.
  if (!pending) {
    return <Navigate to="/transfer" replace />;
  }

  async function handleConfirm() {
    if (!pending) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await createTransfer(session?.token ?? null, {
        fromAccountId: pending.fromAccountId,
        payeeId: pending.payeeId,
        amount: pending.amount,
        memo: pending.memo || undefined,
      });
      if (result.ok) {
        navigate(`/transfer/receipt/${result.receipt.transactionId}`, {
          state: result.receipt,
        });
      } else {
        // 422: show the server message verbatim in a role="alert".
        setError(result.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    // Preserve values by passing them back as router state.
    navigate('/transfer', { state: pending });
  }

  return (
    <main className="screen">
      <div className="card">
        <h1>Review &amp; Confirm</h1>

        <p>From: {pending.fromAccountName}</p>
        <p>Payee: {pending.payeeName}</p>
        <p>Amount: {formatMoney(pending.amount)}</p>
        <p>Memo: {pending.memo ? pending.memo : '—'}</p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <button type="button" onClick={handleConfirm} disabled={submitting}>
            Confirm transfer
          </button>
          <button type="button" className="secondary" onClick={handleBack}>
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
