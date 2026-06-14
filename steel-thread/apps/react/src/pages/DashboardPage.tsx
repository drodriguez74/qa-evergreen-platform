import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { listAccounts, listActivity, type Account, type ActivityItem } from '../api';
import { formatMoney } from '../money';

export function DashboardPage() {
  const navigate = useNavigate();
  const { session, clear } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  // Deliberate a11y defect: this menu is toggled by a non-semantic <div>.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = session?.token ?? null;
    listAccounts(token)
      .then((data) => {
        if (!cancelled) setAccounts(data);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    listActivity(token).then((data) => {
      if (!cancelled) setActivity(data);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleSignOut() {
    clear();
    navigate('/login');
  }

  return (
    <main className="screen">
      <header className="topbar">
        {/*
          DELIBERATE ACCESSIBILITY DEFECT (required by the contract).
          A non-semantic <div> with onClick only: no role, no aria-label,
          no keyboard handler. It is intentionally invisible to getByRole so
          the verification crawl can flag swallowed-click / locator debt.
        */}
        <div className="menu-toggle" onClick={() => setMenuOpen((v) => !v)}>
          ☰
        </div>
        <h1>Dashboard</h1>
      </header>

      {menuOpen && (
        <div className="menu-flyout">
          <p>Menu</p>
        </div>
      )}

      <p className="signed-in">Signed in as {session?.displayName}</p>

      <section>
        <h2>Account Balances</h2>
        <table aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acct) => (
              <tr key={acct.id}>
                <td>{acct.name}</td>
                <td>{formatMoney(acct.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Recent Activity</h2>
        <table aria-label="Recent Activity">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Payee</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((item) => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>{item.payee}</td>
                <td>{formatMoney(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="actions">
        <button type="button" onClick={() => navigate('/transfer')}>
          Initiate Transfer
        </button>
        <button type="button" className="secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}
