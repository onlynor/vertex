import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import AnalyzePage from "./pages/AnalyzePage";
import DashboardPage from "./pages/DashboardPage";
import EvaluationEditorPage from "./pages/EvaluationEditorPage";
import EvaluationsPage from "./pages/EvaluationsPage";
import LoginPage from "./pages/LoginPage";
import PlayersPage from "./pages/PlayersPage";
import ReportsPage from "./pages/ReportsPage";
import ResultPage from "./pages/ResultPage";
import ScreenPage from "./pages/ScreenPage";
import SettingsPage from "./pages/SettingsPage";
import StudentsPage from "./pages/StudentsPage";
import { AuthProvider, useAuth } from "./store/auth";

function RequireAuth() {
  const { teacher, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!teacher) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/analyze" element={<AnalyzePage />} />
              <Route path="/result/:id" element={<ResultPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/players" element={<PlayersPage />} />
              <Route path="/evaluations" element={<EvaluationsPage />} />
              <Route path="/evaluations/:id" element={<EvaluationEditorPage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            {/* 数据大屏全屏展示，不带侧边栏。 */}
            <Route path="/screen" element={<ScreenPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
