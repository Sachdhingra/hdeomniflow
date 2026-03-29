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
  allUsers: User[];
}

const AuthContext = createContext<AuthContextType | null>(null);

const DEMO_USERS: User[] = [
  { id: "1", name: "Admin User", role: "admin", email: "admin@crm.com" },
  { id: "2", name: "Rahul Sharma", role: "sales", email: "sales@crm.com" },
  { id: "6", name: "Neha Verma", role: "sales", email: "sales2@crm.com" },
  { id: "3", name: "Priya Patel", role: "service_head", email: "service@crm.com" },
  { id: "4", name: "Amit Kumar", role: "field_agent", email: "field@crm.com" },
  { id: "7", name: "Ravi Joshi", role: "field_agent", email: "field2@crm.com" },
  { id: "5", name: "Vikram Singh", role: "site_agent", email: "site@crm.com" },
];

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = (email: string, _password: string, role: UserRole) => {
    // Try to find by email first, then fallback to first user of that role
    const found = DEMO_USERS.find(u => u.email === email) || DEMO_USERS.find(u => u.role === role);
    if (found) setUser(found);
  };

  const logout = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, login, logout, allUsers: DEMO_USERS }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
