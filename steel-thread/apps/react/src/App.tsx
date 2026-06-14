import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import type { ReactNode } from 'react';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransferPage } from './pages/TransferPage';
import { ReviewPage } from './pages/ReviewPage';
import { ReceiptPage } from './pages/ReceiptPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/transfer"
        element={
          <RequireAuth>
            <TransferPage />
          </RequireAuth>
        }
      />
      <Route
        path="/transfer/review"
        element={
          <RequireAuth>
            <ReviewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/transfer/receipt/:id"
        element={
          <RequireAuth>
            <ReceiptPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
