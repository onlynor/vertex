import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/LoginPage";
import { AuthProvider, useAuth } from "./store/auth";

// 除登录页外全部懒加载：这些页面（尤其看板/大屏/球员页依赖的 recharts）
// 打进同一个入口 bundle 会导致登录页都要先下载整个应用的 JS。拆开后每个
// 路由按需加载，首屏只需要登录页自己的代码。
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AnalyzePage = lazy(() => import("./pages/AnalyzePage"));
const ResultPage = lazy(() => import("./pages/ResultPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const PlayersPage = lazy(() => import("./pages/PlayersPage"));
const EvaluationsPage = lazy(() => import("./pages/EvaluationsPage"));
const EvaluationEditorPage = lazy(() => import("./pages/EvaluationEditorPage"));
const StudentsPage = lazy(() => import("./pages/StudentsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ScreenPage = lazy(() => import("./pages/ScreenPage"));

function PageFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

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
        <Suspense fallback={<PageFallback />}>
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
