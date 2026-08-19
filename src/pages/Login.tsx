import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2, Loader2, User, Lock, Eye, EyeOff, Users, Wrench, BarChart3,
  MapPin, ReceiptText, PiggyBank, ShieldCheck,
} from "lucide-react";
import { toast } from "@/lib/toast";
import LoginBannerCarousel from "@/components/LoginBannerCarousel";

const REMEMBER_KEY = "furncrm.remember.username";

const Login = () => {
  const { login, loading: authLoading, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setUsername(saved);
      setRemember(true);
    }
  }, []);

  // If landed here with ?next= (e.g. from OAuth consent) and already signed in,
  // bounce back to it.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      window.location.replace(next);
    }
  }, [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("Please enter username and password");
      return;
    }
    setSubmitting(true);
    const error = await login(username, password);
    if (error) {
      toast.error(error);
    } else if (remember) {
      localStorage.setItem(REMEMBER_KEY, username);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    setSubmitting(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const features = [
    { icon: Users, label: "Sales & Leads\nManagement" },
    { icon: Wrench, label: "Service & Job\nTracking" },
    { icon: BarChart3, label: "Real-time\nReports" },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <LoginBannerCarousel />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-12">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Brand / value proposition */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="gradient-primary rounded-xl p-2.5 shadow-card">
                <Building2 className="w-7 h-7 text-primary-foreground" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight">
                Furn<span className="text-primary">CRM</span>
              </h1>
            </div>
            <p className="text-muted-foreground">Furniture Business Management Portal</p>

            <div className="h-1 w-12 rounded-full bg-primary" />

            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Manage. Track. Grow.</h2>
              <p className="text-muted-foreground max-w-md">
                Your complete solution to manage sales, service, customers and business —
                all in one place.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 max-w-lg">
              {features.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-center space-y-2"
                >
                  <Icon className="w-6 h-6 mx-auto text-primary" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide leading-tight whitespace-pre-line text-foreground/80">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Sign in */}
          <section className="w-full max-w-md lg:justify-self-end">
            <Card className="shadow-card-hover">
              <CardContent className="p-6 sm:p-8 space-y-5">
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold">Welcome back! 👋</h2>
                  <p className="text-sm text-muted-foreground">Sign in to continue to FurnCRM</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="username"
                        type="text"
                        className="pl-9"
                        placeholder="Your name"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        className="pl-9 pr-10"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={remember}
                        onCheckedChange={v => setRemember(v === true)}
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => toast.info("Please contact your administrator to reset your password.")}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <Button type="submit" className="w-full gradient-primary" disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                    Sign In
                  </Button>
                </form>

                <div className="border-t pt-4 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                  <span>Sales</span>
                  <span className="w-1 h-1 rounded-full bg-primary" />
                  <span>Service</span>
                  <span className="w-1 h-1 rounded-full bg-primary" />
                  <span>Admin</span>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Trust bar */}
        <div className="mt-8 rounded-xl border bg-card shadow-card px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 divide-y sm:divide-y-0 lg:divide-x">
          <div className="flex items-center gap-3 px-2">
            <MapPin className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">Home Decor Enterprises</p>
              <p className="text-xs text-muted-foreground">Patel Nagar, Dehradun (Opp. Kohli Filling Station)</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-2 pt-4 sm:pt-0">
            <ReceiptText className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm font-medium">Easy EMI Options</p>
          </div>
          <div className="flex items-center gap-3 px-2 pt-4 sm:pt-0">
            <PiggyBank className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm font-medium">0% Finance Available</p>
          </div>
          <div className="flex items-center gap-3 px-2 pt-4 sm:pt-0">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm font-medium">Trusted Since 2006</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
