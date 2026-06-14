import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api';
import { useAuth } from '../auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(username, password);
      setSession(res);
      navigate('/dashboard');
    } catch {
      setError('Invalid username or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen screen--centered">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <h1>Sign in to FundFlow</h1>

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          Sign in
        </button>
      </form>
    </main>
  );
}
