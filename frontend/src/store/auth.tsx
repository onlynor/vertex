import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearToken, getToken, setToken } from "../lib/api";
import type { Teacher } from "../types";

interface AuthState {
  teacher: Teacher | null;
  loading: boolean;
  login: (username: string, password: string, accessPassword: string) => Promise<void>;
  register: (username: string, password: string, name: string, accessPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setTeacher)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string, accessPassword: string) => {
    const res = await api.login(username, password, accessPassword);
    setToken(res.token);
    setTeacher(res.teacher);
  }, []);

  const register = useCallback(
    async (username: string, password: string, name: string, accessPassword: string) => {
      const res = await api.register(username, password, name, accessPassword);
      setToken(res.token);
      setTeacher(res.teacher);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setTeacher(null);
  }, []);

  const value = useMemo(
    () => ({ teacher, loading, login, register, logout }),
    [teacher, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
