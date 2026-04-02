import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export type UserRole = "admin" | "sales" | "service_head" | "field_agent" | "site_agent";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  forceLogout: () => Promise<void>;
  allProfiles: User[];
  refreshProfiles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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

  return {
    id: sbUser.id,
    name: profile.name,
    email: profile.email,
    role,
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [allProfiles, setAllProfiles] = useState<User[]>([]);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const appUser = await buildUser(session.user);
          setUser(appUser);
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const appUser = await buildUser(session.user);
        setUser(appUser);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) refreshProfiles();
  }, [user]);

  const login = async (username: string, password: string): Promise<string | null> => {
    // Convert username to internal email format
    const email = `${username.toLowerCase().replace(/\s+/g, ".")}@furncrm.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes("Invalid login")) {
        return "Invalid username or password";
      }
      if (error.message.includes("banned") || error.message.includes("disabled")) {
        return "Your account has been disabled. Contact admin.";
      }
      return error.message;
    }
    return null;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    // Clear all app-related storage
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch {}
  };

  const forceLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {}
    setUser(null);
    try {
      localStorage.clear();
      sessionStorage.clear();
      // Clear caches
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {}
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, forceLogout, allProfiles, refreshProfiles }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
