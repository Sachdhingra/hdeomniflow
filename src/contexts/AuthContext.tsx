import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export type UserRole = "admin" | "sales" | "service_head" | "field_agent" | "site_agent" | "accounts";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

type AuthState = "UNAUTHENTICATED" | "AUTHENTICATING" | "AUTHENTICATED" | "LOGGING_OUT";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authState: AuthState;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  forceLogout: () => Promise<void>;
  allProfiles: User[];
  refreshProfiles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const APP_VERSION = "1.3.0";
const AUTH_TIMEOUT_MS = 30000;

/** Clear all auth-related storage. Preserves app version key. */
const clearAuthCache = (preserveVersion = true) => {
  console.log("🗑️ [Auth] Clearing auth cache…");
  try {
    const versionVal = preserveVersion ? localStorage.getItem("furncrm_app_version") : null;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("sb-") || key.includes("auth") || key.includes("user") || key.startsWith("furncrm_cache_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
    if (versionVal) localStorage.setItem("furncrm_app_version", versionVal);
    console.log(`🗑️ [Auth] Cleared ${keysToRemove.length} keys`);
  } catch (e) {
    console.error("❌ [Auth] Cache clear failed:", e);
  }
};

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
};

async function fetchUserRole(userId: string): Promise<UserRole | null> {
  const { data } = await supabase.rpc("get_user_role", { _user_id: userId });
  return (data as UserRole) || null;
}

async function buildUser(sbUser: SupabaseUser): Promise<User | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", sbUser.id)
    .single();

  const role = await fetchUserRole(sbUser.id);
  if (!profile || !role) return null;

  return { id: sbUser.id, name: profile.name, email: profile.email, role };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<AuthState>("UNAUTHENTICATED");
  const [allProfiles, setAllProfiles] = useState<User[]>([]);
  const loginInFlight = useRef(false);
  const logoutInFlight = useRef(false);

  const setState = (s: AuthState) => {
    console.log(`🔄 [Auth] State: ${s}`);
    setAuthState(s);
  };

  const refreshProfiles = async () => {
    const { data: profiles } = await supabase.from("profiles").select("id, name, email, active");
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    if (profiles && roles) {
      const users: User[] = profiles
        .map(p => {
          const r = roles.find(r => r.user_id === p.id);
          if (!r) return null;
          return { id: p.id, name: p.name, email: p.email, role: r.role as UserRole, active: (p as any).active };
        })
        .filter(Boolean) as User[];
      setAllProfiles(users);
    }
  };

  useEffect(() => {
    // Version cache busting (preserves auth)
    const storedVersion = localStorage.getItem("furncrm_app_version");
    if (storedVersion !== APP_VERSION) {
      console.log("🆕 [Auth] New app version, clearing non-auth cache");
      const authBackup: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("sb-")) authBackup[k] = localStorage.getItem(k) || "";
      }
      localStorage.clear();
      sessionStorage.clear();
      Object.entries(authBackup).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem("furncrm_app_version", APP_VERSION);
    }

    // Unregister stale service workers
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister());
      }).catch(() => {});
    }

    // Auth state change listener (handles login, logout, token refresh, cross-tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`🔔 [Auth] Event: ${event}`);

      // Defer async work to avoid deadlock
      if (session?.user) {
        setTimeout(async () => {
          try {
            const appUser = await withTimeout(buildUser(session.user), AUTH_TIMEOUT_MS, "buildUser");
            if (appUser) {
              setUser(appUser);
              setState("AUTHENTICATED");
              console.log("✅ [Auth] User restored:", appUser.email);
            } else {
              console.warn("⚠️ [Auth] Profile/role missing — signing out");
              await supabase.auth.signOut({ scope: "local" });
              clearAuthCache();
              setUser(null);
              setState("UNAUTHENTICATED");
            }
          } catch (e) {
            console.error("❌ [Auth] buildUser failed:", e);
            clearAuthCache();
            setUser(null);
            setState("UNAUTHENTICATED");
          } finally {
            setLoading(false);
          }
        }, 0);
      } else {
        setUser(null);
        setState("UNAUTHENTICATED");
        setLoading(false);
      }
    });

    // Initial session check with timeout safety
    withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, "getSession")
      .then(({ data: { session } }) => {
        if (!session) {
          setLoading(false);
        }
        // If session exists, onAuthStateChange handles it
      })
      .catch(e => {
        console.error("❌ [Auth] getSession timeout:", e);
        clearAuthCache();
        setUser(null);
        setState("UNAUTHENTICATED");
        setLoading(false);
      });

    // Cross-tab sync: react when auth changes in another tab
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("sb-") && e.newValue === null) {
        console.log("🔄 [Auth] Detected logout in another tab");
        setUser(null);
        setState("UNAUTHENTICATED");
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (user) refreshProfiles();
  }, [user]);

  const login = async (username: string, password: string): Promise<string | null> => {
    if (loginInFlight.current) {
      console.warn("⚠️ [Auth] Login already in progress");
      return "Already logging in…";
    }
    loginInFlight.current = true;
    setState("AUTHENTICATING");
    console.log("🔐 [Auth] Login attempt:", username);

    try {
      // Clear any stale auth before fresh login
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {}
      clearAuthCache();

      const email = `${username.toLowerCase().replace(/\s+/g, ".")}@furncrm.local`;
      console.log("📤 [Auth] Sending credentials…");

      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        AUTH_TIMEOUT_MS,
        "signInWithPassword"
      );

      if (error) {
        console.error("❌ [Auth] Login failed:", error.message);
        clearAuthCache();
        setState("UNAUTHENTICATED");
        if (error.message.includes("Invalid login")) return "Invalid username or password";
        if (error.message.includes("banned") || error.message.includes("disabled")) {
          return "Your account has been disabled. Contact admin.";
        }
        return error.message;
      }

      console.log("✅ [Auth] Login successful");
      // onAuthStateChange will set AUTHENTICATED
      return null;
    } catch (e: any) {
      console.error("❌ [Auth] Login exception:", e);
      clearAuthCache();
      setState("UNAUTHENTICATED");
      return e?.message?.includes("timed out")
        ? "Login timed out. Check your connection and try again."
        : "Login failed. Please try again.";
    } finally {
      loginInFlight.current = false;
    }
  };

  const logout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setState("LOGGING_OUT");
    console.log("🔐 [Auth] Logout initiated");

    try {
      // Optimistic clear — update UI immediately
      setUser(null);

      try {
        await withTimeout(supabase.auth.signOut(), 10000, "signOut");
        console.log("✅ [Auth] Server session revoked");
      } catch (e) {
        console.warn("⚠️ [Auth] signOut failed/timed out, clearing locally:", e);
      }

      clearAuthCache();
      setState("UNAUTHENTICATED");
      console.log("✅ [Auth] Logout complete");
    } finally {
      logoutInFlight.current = false;
    }
  };

  const forceLogout = async () => {
    console.log("🚨 [Auth] Force logout");
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {}
    setUser(null);
    setState("UNAUTHENTICATED");
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {}
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, authState, login, logout, forceLogout, allProfiles, refreshProfiles }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
