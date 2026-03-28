import { useState } from "react";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Wrench, MapPin, Navigation, Shield } from "lucide-react";

const ROLES: { value: UserRole; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "admin", label: "Admin", icon: <Shield className="w-5 h-5" />, desc: "Full access to all modules" },
  { value: "sales", label: "Sales Team", icon: <Users className="w-5 h-5" />, desc: "Manage leads & pipeline" },
  { value: "service_head", label: "Service Head", icon: <Wrench className="w-5 h-5" />, desc: "Service jobs & claims" },
  { value: "field_agent", label: "Field Agent", icon: <Navigation className="w-5 h-5" />, desc: "On-site service visits" },
  { value: "site_agent", label: "Site Agent", icon: <MapPin className="w-5 h-5" />, desc: "New site prospecting" },
];

const Login = () => {
  const { login } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole>("sales");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login(email, password, selectedRole);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 gradient-primary rounded-xl px-4 py-2">
            <Building2 className="w-6 h-6 text-primary-foreground" />
            <span className="text-xl font-bold text-primary-foreground tracking-tight">FurnCRM</span>
          </div>
          <p className="text-muted-foreground text-sm">Furniture Business Management Portal</p>
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Select Role & Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {ROLES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRole(r.value)}
                  className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all text-sm ${
                    selectedRole === r.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={selectedRole === r.value ? "text-primary" : "text-muted-foreground"}>{r.icon}</span>
                    <span className="font-medium">{r.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{r.desc}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full gradient-primary">
                Sign In as {ROLES.find(r => r.value === selectedRole)?.label}
              </Button>
            </form>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Demo mode — click Sign In with any role to explore
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
