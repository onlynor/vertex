import { useEffect, useState, type FormEvent } from "react";
import { IconCheck, IconSettings, IconSpark } from "../components/Icons";
import { Button, Card, Input, Spinner, Toast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../store/auth";
import type { LLMSettings } from "../types";

export default function SettingsPage() {
  const { teacher } = useAuth();
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        setSettings(data);
        setBaseUrl(data.base_url);
        setModel(data.model);
      })
      .catch(() => undefined);
  }, []);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2400);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.saveSettings({ api_key: apiKey, base_url: baseUrl, model });
      const fresh = await api.getSettings();
      setSettings(fresh);
      setApiKey("");
      flash("配置已保存并加密存入数据库");
    } catch (err) {
      flash(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testSettings({ api_key: apiKey, base_url: baseUrl, model });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setOldPassword("");
      setNewPassword("");
      flash("密码已更新");
    } catch (err) {
      flash(err instanceof Error ? err.message : "密码更新失败");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="animate-fade-up">
        <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">设置</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          配置视频分析所使用的多模态模型，以及账号安全设置
        </p>
      </div>

      <Card className="animate-fade-up p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <IconSpark className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">AI 模型配置</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              任何 OpenAI 兼容接口均可接入（DeepSeek / 豆包 / Kimi / Qwen 等），换模型只需改这里
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="API Key"
            type="password"
            placeholder={settings?.has_api_key ? `已配置：${settings.api_key_masked}（留空则不修改）` : "请输入 API Key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            label="接口地址 Base URL"
            placeholder="https://api.deepseek.com/"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
          />
          <Input
            label="模型名称"
            placeholder="deepseek-v4-flash-vision-exp"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            required
          />

          {testResult && (
            <div
              className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ${
                testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
              }`}
            >
              {testResult.ok && <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="leading-relaxed">{testResult.message}</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={handleTest} disabled={testing}>
              {testing ? <Spinner className="h-4 w-4" /> : "测试连接"}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "保存配置"}
            </Button>
          </div>
        </form>

        <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
          🔒 API Key 使用 AES-256-GCM 加密后存入数据库，页面不会回显明文；训练报告正文与封面图同样加密存储。
        </p>
      </Card>

      <Card className="animate-fade-up p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <IconSettings className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">账号安全</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              当前账号：{teacher?.username}（{teacher?.role === "admin" ? "管理员" : "教师"}）
            </p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            label="当前密码"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
          />
          <Input
            label="新密码"
            type="password"
            placeholder="至少 6 位"
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={changingPassword}>
            {changingPassword ? (
              <Spinner className="h-4 w-4 border-white/40 border-t-white" />
            ) : (
              "修改密码"
            )}
          </Button>
        </form>
      </Card>

      {toast && <Toast message={toast} tone={toast.includes("失败") ? "error" : "success"} />}
    </div>
  );
}
