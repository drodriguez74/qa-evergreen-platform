import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginResponse } from './api';

export interface Session {
  token: string;
  role: 'analyst' | 'supervisor';
  displayName: string;
  approvalLimit: number | null;
}

interface AuthContextValue {
  session: Session | null;
  setSession: (login: LoginResponse) => void;
  clear: () => void;
}

const STORAGE_KEY = 'fundflow.session';

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => readSession());

  const setSession = useCallback((login: LoginResponse) => {
    const next: Session = {
      token: login.token,
      role: login.role,
      displayName: login.displayName,
      approvalLimit: login.approvalLimit ?? null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSessionState(next);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSessionState(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, setSession, clear }),
    [session, setSession, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
