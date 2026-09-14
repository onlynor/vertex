import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { BrandLockup } from "./Brand";
import { NetPattern, PitchMarkings } from "./Football";
import {
  IconClipboard,
  IconHome,
  IconLogout,
  IconRadar,
  IconReport,
  IconScreen,
  IconSettings,
  IconUsers,
  IconVideo,
} from "./Icons";

const pageTitles: Record<string, string> = {
  "/": "首页",
  "/analyze": "视频分析",
  "/reports": "训练报告",
  "/players": "球员能力",
  "/evaluations": "智能评价",
  "/students": "学生管理",
  "/settings": "设置",
};

function titleFor(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/result")) return "分析结果";
  if (pathname.startsWith("/evaluations")) return "智能评价";
  return "";
}

const navItems = [
  { to: "/", label: "首页", icon: IconHome, end: true },
  { to: "/analyze", label: "视频分析", icon: IconVideo, end: false },
  { to: "/reports", label: "训练报告", icon: IconReport, end: false },
  { to: "/players", label: "球员能力", icon: IconRadar, end: false },
  { to: "/evaluations", label: "智能评价", icon: IconClipboard, end: false },
  { to: "/students", label: "学生管理", icon: IconUsers, end: false },
  { to: "/settings", label: "设置", icon: IconSettings, end: false },
];

export default function Layout() {
  const { teacher, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 每次发生路由跳转时关闭移动端抽屉。
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // 不要让页面在抽屉打开时还能在背后滚动。
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const sidebar = (
    <>
      <div className="relative flex items-center gap-2.5 px-6 py-6">
        <NetPattern id="sidebar-net" className="absolute inset-0 text-white/[0.05]" />
        <BrandLockup className="relative" />
      </div>

      <nav className="relative flex-1 space-y-1 px-3 py-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.6)]"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
              }`
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>

      <PitchMarkings className="pointer-events-none absolute inset-x-0 bottom-16 h-48 w-full text-white/[0.05]" />

      <div className="relative space-y-1 px-3 pb-5">
        <Link
          to="/screen"
          className="group mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-brand-600/25 to-emerald-500/20 px-3.5 py-2.5 text-sm font-medium text-white transition hover:from-brand-600/40 hover:to-emerald-500/30"
        >
          <IconScreen className="h-[18px] w-[18px] text-emerald-300" />
          数据大屏
          <span className="ml-auto text-xs text-slate-400 transition group-hover:text-white">全屏 ↗</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-400 transition-all hover:bg-white/[0.06] hover:text-white"
        >
          <IconLogout className="h-[18px] w-[18px]" />
          退出登录
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-svh bg-[#f5f6f8]">
      {/* 桌面端侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-hidden bg-ink-950 lg:flex">
        {sidebar}
      </aside>

      {/* 移动端抽屉 */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex w-64 flex-col overflow-hidden bg-ink-950 shadow-2xl transition-transform duration-300 ease-out ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebar}
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-60">
        <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/85 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10 lg:py-3.5">
            <button
              onClick={() => setDrawerOpen(true)}
              className="-ml-1 flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 lg:hidden"
              aria-label="打开菜单"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="lg:hidden">
              <BrandLockup size="sm" tone="dark" />
            </div>

            <h2 className="hidden flex-1 text-[15px] font-semibold text-slate-900 lg:block">
              {titleFor(location.pathname)}
            </h2>

            <div className="relative shrink-0">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
                className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 transition hover:bg-slate-100 sm:pr-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-semibold text-white">
                  {teacher?.name?.[0] ?? "师"}
                </div>
                <span className="hidden text-sm font-medium text-slate-700 sm:block">
                  {teacher?.name}
                </span>
                <svg className="hidden h-4 w-4 text-slate-400 sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {menuOpen && (
                <div className="animate-fade-up absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-black/[0.06] bg-white py-1 shadow-lg">
                  <div className="px-4 py-2.5">
                    <p className="text-sm font-medium text-slate-800">{teacher?.name}</p>
                    <p className="text-xs text-slate-500">
                      {teacher?.role === "admin" ? "管理员" : "教师"} · {teacher?.username}
                    </p>
                  </div>
                  <div className="border-t border-slate-100">
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50"
                    >
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
