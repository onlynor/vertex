import type {
  ClassInfo,
  EvaluationFillResult,
  EvaluationOptions,
  EvaluationSavePayload,
  EvaluationSchema,
  EvaluationSheet,
  EvaluationSheetSummary,
  LLMSettings,
  ScreenStats,
  StatsOverview,
  Student,
  StudentEvaluationRecord,
  StudentImportResult,
  Teacher,
  VideoRecord,
  XlsxSheet,
} from "../types";

const TOKEN_KEY = "football_ai_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, { ...init, headers });

  // 登录接口返回 401 表示“账号密码错误”，而不是“会话过期”，
  // 因此让登录接口自己的提示透传出去，不要被下面这段逻辑劫持。
  if (res.status === 401 && path !== "/auth/login") {
    clearToken();
    // 让路由守卫在下次渲染时接管，跳转到登录页。
    if (!location.pathname.startsWith("/login")) location.href = "/login";
    throw new ApiError("登录状态已失效，请重新登录", 401);
  }

  const contentType = res.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) throw new ApiError("请求失败", res.status);
    return (await res.blob()) as T;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || "请求失败", res.status);
  return data as T;
}

export const api = {
  login: (username: string, password: string, accessPassword: string) =>
    request<{ token: string; teacher: Teacher }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, access_password: accessPassword }),
    }),

  register: (username: string, password: string, name: string, accessPassword: string) =>
    request<{ token: string; teacher: Teacher }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, name, access_password: accessPassword }),
    }),

  me: () => request<Teacher>("/auth/me"),

  changePassword: (old_password: string, new_password: string) =>
    request<{ message: string }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ old_password, new_password }),
    }),

  listStudents: (keyword?: string) =>
    request<{ items: Student[] }>(
      `/students${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`,
    ),

  createStudent: (payload: Partial<Student>) =>
    request<Student>("/students", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateStudent: (id: number, payload: Partial<Student>) =>
    request<Student>(`/students/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteStudent: (id: number) =>
    request<{ message: string }>(`/students/${id}`, { method: "DELETE" }),

  analyzeVideo: (file: File, studentId: number) => {
    const form = new FormData();
    form.append("video", file);
    form.append("student_id", String(studentId));
    return request<{ id: number; task_id: string }>("/videos/analyze", {
      method: "POST",
      body: form,
    });
  },

  getVideo: (id: number | string) => request<VideoRecord>(`/videos/${id}`),

  listVideos: (params: { status?: string; student_id?: number; class_name?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.student_id) query.set("student_id", String(params.student_id));
    if (params.class_name !== undefined) query.set("class_name", params.class_name);
    if (params.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<{ items: VideoRecord[] }>(`/videos${qs ? `?${qs}` : ""}`);
  },

  deleteVideo: (id: number) =>
    request<{ message: string }>(`/videos/${id}`, { method: "DELETE" }),

  stats: () => request<StatsOverview>("/stats/overview"),

  screenStats: () => request<ScreenStats>("/stats/screen"),

  listClasses: () => request<{ items: ClassInfo[] }>("/classes"),

  renameClass: (from: string, to: string) =>
    request<{ name: string; students: number }>("/classes/rename", {
      method: "PUT",
      body: JSON.stringify({ from, to }),
    }),

  normalizeClasses: () =>
    request<{ changes: { from: string; to: string; students: number }[] }>("/classes/normalize", {
      method: "POST",
    }),

  getSettings: () => request<LLMSettings>("/settings/llm"),

  saveSettings: (payload: { api_key: string; base_url: string; model: string }) =>
    request<{ message: string }>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  testSettings: (payload: { api_key: string; base_url: string; model: string }) =>
    request<{ ok: boolean; message: string }>("/settings/llm/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // 导出接口需要携带鉴权请求头，因此不能直接用 <a download> 链接下载：
  // 先 fetch 拿到文件，再把 blob URL 交给浏览器。导出范围与列表当前的班级、学生筛选一致。
  exportReports: (format: "csv" | "xlsx", filter: { student?: { id: number; name: string }; className?: string } = {}) => {
    const query = new URLSearchParams({ format });
    if (filter.student) query.set("student_id", String(filter.student.id));
    else if (filter.className !== undefined) query.set("class_name", filter.className);
    const scope = filter.student?.name ?? (filter.className !== undefined ? filter.className || "未分班" : "");
    return downloadAuthed(
      `/api/reports/export?${query}`,
      `训练报告_${scope ? `${scope}_` : ""}${new Date().toISOString().slice(0, 10)}.${format}`,
    );
  },

  /** 把整理好的表格交给后端生成 Excel（球员能力、智能评价的导出共用）。 */
  exportXlsx: async (filename: string, sheets: XlsxSheet[]) => {
    const blob = await request<Blob>("/export/xlsx", {
      method: "POST",
      body: JSON.stringify({ filename, sheets }),
    });
    saveBlob(blob, `${filename}.xlsx`);
  },

  evaluationSchema: () => request<EvaluationSchema>("/evaluations/schema"),

  listEvaluations: () => request<{ items: EvaluationSheetSummary[] }>("/evaluations"),

  createEvaluation: (payload: {
    kind: string;
    class_name: string;
    title: string;
    lesson_date: string;
    teacher_name: string;
    options: EvaluationOptions;
  }) =>
    request<EvaluationSheet>("/evaluations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getEvaluation: (id: number) => request<EvaluationSheet>(`/evaluations/${id}`),

  // keepalive 让页面关闭或跳转时发出的最后一次保存也能送达。
  saveEvaluation: (id: number, payload: EvaluationSavePayload, options: { keepalive?: boolean } = {}) =>
    request<{ updated_at: string; recorded_count: number; commented_count: number }>(`/evaluations/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      keepalive: options.keepalive,
    }),

  deleteEvaluation: (id: number) =>
    request<{ message: string }>(`/evaluations/${id}`, { method: "DELETE" }),

  // AI 一键评价：一次为若干名学生填出整行评价和评语；overwrite 为 true 时连已填的一起重填。
  fillEvaluation: (id: number, studentIds: number[], overwrite: boolean) =>
    request<{ items: EvaluationFillResult[] }>(`/evaluations/${id}/fill`, {
      method: "POST",
      body: JSON.stringify({ student_ids: studentIds, overwrite }),
    }),

  generateComments: (id: number, studentIds: number[]) =>
    request<{ items: { student_id: number; comment?: string; error?: string }[] }>(
      `/evaluations/${id}/comments`,
      { method: "POST", body: JSON.stringify({ student_ids: studentIds }) },
    ),

  generateSummary: (id: number) =>
    request<{ summary: string }>(`/evaluations/${id}/summary`, { method: "POST" }),

  studentEvaluations: (studentId: number) =>
    request<{ items: StudentEvaluationRecord[] }>(`/students/${studentId}/evaluations`),

  importStudents: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<StudentImportResult>("/students/import", {
      method: "POST",
      body: form,
    });
  },

  downloadImportTemplate: (format: "csv" | "xlsx") =>
    downloadAuthed(
      `/api/students/import-template?format=${format}`,
      `学生导入模板.${format}`,
    ),
};

/** 携带 bearer token 拉取受保护的文件，再通过 blob URL 触发保存。 */
async function downloadAuthed(path: string, filename: string) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) throw new Error("下载失败");
  saveBlob(await res.blob(), filename);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function thumbUrl(id: number) {
  return `/api/videos/${id}/thumb`;
}

// <video> 标签无法发送 Authorization 请求头，因此该路由把 token 放在
// 查询字符串里（参见后端 auth.MediaMiddleware）。
export function videoFileUrl(id: number) {
  return `/api/videos/${id}/file?token=${encodeURIComponent(getToken() ?? "")}`;
}
