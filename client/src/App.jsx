import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { PanelSkeleton } from './components/ui/index.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const Goals = lazy(() => import('./pages/Goals.jsx'));
const Recurring = lazy(() => import('./pages/Recurring.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Forecast = lazy(() => import('./pages/Forecast.jsx'));
const Scanner = lazy(() => import('./pages/Scanner.jsx'));
const Assistant = lazy(() => import('./pages/Assistant.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Income = lazy(() => import('./pages/Income.jsx'));
const Converter = lazy(() => import('./pages/Converter.jsx'));

/** Route protection: unauthenticated visitors are sent to /login and returned to where they were headed. */
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}><PanelSkeleton rows={3} /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: window.location.pathname }} />;
  return children;
}
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Suspense fallback={<div className="main"><PanelSkeleton rows={5} /></div>}>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="income" element={<Income />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="scan" element={<Scanner />} />
          <Route path="converter" element={<Converter />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="forecast" element={<Forecast />} />
          <Route path="reports" element={<Reports />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="goals" element={<Goals />} />
          <Route path="recurring" element={<Recurring />} />
          <Route path="categories" element={<Categories />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
