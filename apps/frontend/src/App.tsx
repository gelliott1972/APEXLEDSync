import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth-store';
import { useSessionStore } from './stores/session-store';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { StatusBoardPage } from './pages/StatusBoard';
import { AdminPage } from './pages/Admin';
import { Toaster } from './components/ui/toaster';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();

  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated } = useAuthStore();
  const { restoreSession } = useSessionStore();

  // Restore session from backend on app mount (if authenticated)
  useEffect(() => {
    if (isAuthenticated) {
      restoreSession();
    }
  }, [isAuthenticated, restoreSession]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="status-board" element={<StatusBoardPage />} />
          <Route
            path="admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
