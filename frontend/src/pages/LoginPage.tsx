import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import pitchPhoto from "../assets/pitch.webp";
import { BRAND, BrandLockup } from "../components/Brand";
import { NetPattern, SoccerBall } from "../components/Football";
import { IconReport, IconSpark, IconVideo } from "../components/Icons";
import { Button, Input, Spinner } from "../components/ui";
import { useAuth } from "../store/auth";

const features = [
  { icon: IconVideo, title: "自动识别训练项目", desc: "颠球、运球、传接球、射门等" },
  { icon: IconSpark, title: "生成改进建议", desc: "指出问题并给出可执行的练习方向" },
  { icon: IconReport, title: "保存训练记录", desc: "视频与报告可随时回放、导出" },
];

/**
 * 与后端 handler.validatePassword 中的规则保持一致，让教师在发起请求前
 * 就能看到问题所在。服务器端仍然是权威校验。
 */
function validateCredentials(username: string, password: string): string | null {
  if (username.length < 6 || username.length > 12) return "用户名需为 6~12 位";
  if (!/^[A-Za-z0-9]+$/.test(username)) return "用户名只能包含字母和数字";
  if (password.length < 6 || password.length > 12) return "密码需为 6~12 位";
  if (!/^[A-Za-z0-9]+$/.test(password)) return "密码只能包含字母和数字";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    return "密码需同时包含字母和数字";
  return null;
}

export default function LoginPage() {
  const { teacher, login, register, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-ink-950">
        <SoccerBall className="spin-ball h-12 w-12" />
      </div>
    );
  }
  if (teacher) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (isRegister) {
      const invalid = validateCredentials(username, password);
      if (invalid) {
        setError(invalid);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      if (isRegister) {
        await register(username, password, name);
      } else {
        await login(username, password);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : isRegister ? "注册失败" : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // 全出血设计：草坪照片铺满整个视口，不加卡片边框。
    <div className="relative min-h-svh w-full overflow-hidden bg-ink-950">
      <img
        src={pitchPhoto}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[100%_center]"
        fetchPriority="high"
      />
      {/* 遮罩层左侧（文字后方）最深、中间渐浅，
          这样照片里的足球能在文字栏与登录卡片之间的空隙处保持可见。 */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/92 via-ink-950/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/70 via-transparent to-ink-950/45" />
      <NetPattern id="login-net" className="absolute top-0 right-0 h-72 w-96 text-white/[0.06]" />

      <div className="relative mx-auto flex min-h-svh w-full max-w-[1600px] flex-col px-6 sm:px-10 lg:px-16">
        <header className="flex items-center py-7">
          <BrandLockup className="drop-shadow-lg" />
        </header>

        <div className="flex flex-1 items-center py-10">
          <div className="grid w-full items-center gap-12 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
            <div className="animate-fade-up w-full lg:w-[400px]">
              <div className="rounded-3xl bg-white/95 p-8 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:p-9">
                <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
                  {(["login", "register"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setMode(tab);
                        setError(null);
                      }}
                      className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                        mode === tab
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {tab === "login" ? "登录" : "注册"}
                    </button>
                  ))}
                </div>

                <h2 className="display-tight text-[27px] font-semibold text-slate-900">
                  {isRegister ? "创建账号" : "登录"}
                </h2>
                <p className="mt-1.5 text-sm text-slate-500">
                  {isRegister ? "注册一个教师账号即可开始使用" : `欢迎使用 ${BRAND.latin} ${BRAND.chinese}`}
                </p>

                <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                  <Input
                    label="用户名"
                    placeholder={isRegister ? "6~12 位字母或数字" : "请输入用户名"}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                  {isRegister && (
                    <Input
                      label="姓名"
                      placeholder="显示在系统中的称呼，可留空"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  )}
                  <Input
                    label="密码"
                    type="password"
                    placeholder={isRegister ? "6~12 位，需含字母和数字" : "请输入密码"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    required
                  />

                  {error && (
                    <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
                  )}

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full !rounded-xl !py-3.5 !text-[15px]"
                  >
                    {submitting ? (
                      <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                    ) : isRegister ? (
                      "注册并登录"
                    ) : (
                      "登录"
                    )}
                  </Button>
                </form>

                <p className="mt-7 text-center text-xs text-slate-400">仅供教学使用</p>
              </div>
            </div>
            <div className="animate-fade-up max-w-sm">
              <p className="text-[11.5px] font-medium tracking-[0.18em] text-emerald-300 uppercase">
                {BRAND.tagline}
              </p>
              <h1 className="display-tight mt-3 flex items-baseline gap-3 text-[34px] leading-[1.2] font-semibold text-white sm:text-[42px]">
                <span className="tracking-[0.08em]">{BRAND.latin}</span>
                <span className="text-[0.66em] text-slate-300">{BRAND.chinese}</span>
              </h1>
              <p className="mt-5 text-[15px] leading-relaxed text-slate-300 sm:text-[16px]">
                上传学生的足球训练视频，系统会自动识别训练项目，
                生成包含动作表现、存在问题和改进建议的训练报告，
                视频与报告都会保存下来，方便随时回放和对比。
              </p>

              <div className="mt-8 space-y-3">
                {features.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex items-center gap-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.1] text-brand-200">
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-white">{title}</p>
                      <p className="mt-0.5 text-[12px] text-slate-400">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
