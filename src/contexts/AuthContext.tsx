import React, { createContext, useContext, useState, ReactNode } from "react";

export type UserRole = "admin" | "sales" | "service_head" | "field_agent" | "site_agent";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: UserRole) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Demo users for UI prototype
const DEMO_USERS: Record<UserRole, User> = {
  admin: { id: "1", name: "Admin User", role: "admin", email: "admin@crm.com" },
  sales: { id: "2", name: "Rahul Sharma", role: "sales", email: "sales@crm.com" },
  service_head: { id: "3", name: "Priya Patel", role: "service_head", email: "service@crm.com" },
  field_agent: { id: "4", name: "Amit Kumar", role: "field_agent", email: "field@crm.com" },
  site_agent: { id: "5", name: "Vikram Singh", role: "site_agent", email: "site@crm.com" },
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = (_email: string, _password: string, role: UserRole) => {
    setUser(DEMO_USERS[role]);
  };

  const logout = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
