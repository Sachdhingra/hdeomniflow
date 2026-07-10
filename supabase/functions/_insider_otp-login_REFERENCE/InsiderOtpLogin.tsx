// ⚠️ COPY THIS FILE INTO THE INSIDER PWA PROJECT (homedecorinsider).
// Register the route in that project's src/App.tsx:
//   <Route path="/login" element={<InsiderOtpLogin />} />
//
// This screen lets a returning Insider (Elite customer) sign in with a
// 6-digit SMS OTP sent by the Omni `insider-send-otp` edge function and
// verified by `insider-verify-otp`.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type Step = "phone" | "code";

const errorMessage = (code?: string) => {
  switch (code) {
    case "invalid_phone": return "Enter a valid 10-digit Indian mobile number.";
    case "not_registered": return "This number isn't registered with Home Decor Insider yet. Please ask the store to enroll you.";
    case "rate_limited": return "Too many OTP requests. Please try again in an hour.";
    case "sms_not_configured":
    case "sms_send_failed": return "Couldn't send the SMS right now. Please try again shortly.";
    case "no_pending_code": return "Please request a new code.";
    case "expired": return "This code has expired. Please request a new one.";
    case "too_many_attempts": return "Too many wrong attempts. Please request a new code.";
    case "wrong_code": return "Incorrect code. Please check and try again.";
    case "invalid_code": return "Enter the 6-digit code from your SMS.";
    default: return "Something went wrong. Please try again.";
  }
};

async function invokeError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      return errorMessage(body?.error) || fallback;
    } catch { /* ignore */ }
  }
  return fallback;
}

export default function InsiderOtpLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // If already signed in, bounce home.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendOtp = async () => {
    setMsg(null);
    const ten = phone.replace(/\D/g, "").slice(-10);
    if (ten.length !== 10) { setMsg(errorMessage("invalid_phone")); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("insider-send-otp", {
        body: { phone: ten },
      });
      if (error) { setMsg(await invokeError(error, "Couldn't send OTP.")); return; }
      setStep("code");
      setCooldown(30); // seconds until "Resend" available
      setMsg("We sent a 6-digit code by SMS.");
    } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    setMsg(null);
    if (!/^\d{6}$/.test(code)) { setMsg(errorMessage("invalid_code")); return; }
    setBusy(true);
    try {
      const ten = phone.replace(/\D/g, "").slice(-10);
      const { data, error } = await supabase.functions.invoke("insider-verify-otp", {
        body: { phone: ten, code },
      });
      if (error || !data?.hashed_token) {
        setMsg(await invokeError(error, "Couldn't verify the code."));
        return;
      }
      const { error: signInErr } = await supabase.auth.verifyOtp({
        token_hash: data.hashed_token,
        type: "email",
      });
      if (signInErr) { setMsg(signInErr.message); return; }
      navigate("/", { replace: true });
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-center">Sign in to Home Decor Insider</h1>

        {step === "phone" && (
          <>
            <label className="block text-sm font-medium">Registered mobile number</label>
            <div className="flex items-center gap-2 border rounded-md px-3 py-2">
              <span className="text-sm text-muted-foreground">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                autoFocus
                placeholder="10-digit mobile"
                className="flex-1 outline-none bg-transparent"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
            </div>
            <button
              onClick={sendOtp}
              disabled={busy || phone.length !== 10}
              className="w-full rounded-md bg-primary text-primary-foreground py-2 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Send OTP
            </button>
          </>
        )}

        {step === "code" && (
          <>
            <p className="text-sm text-muted-foreground text-center">
              Enter the 6-digit code sent to <b>+91 {phone}</b>
            </p>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              placeholder="••••••"
              className="w-full border rounded-md px-3 py-3 text-center tracking-[0.5em] text-lg"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button
              onClick={verifyOtp}
              disabled={busy || code.length !== 6}
              className="w-full rounded-md bg-primary text-primary-foreground py-2 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify & sign in
            </button>
            <button
              onClick={() => { if (cooldown === 0) sendOtp(); }}
              disabled={cooldown > 0 || busy}
              className="w-full text-sm text-muted-foreground underline disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <button
              onClick={() => { setStep("phone"); setCode(""); setMsg(null); }}
              className="w-full text-sm text-muted-foreground"
            >
              Change number
            </button>
          </>
        )}

        {msg && <p className="text-sm text-center text-muted-foreground">{msg}</p>}
      </div>
    </div>
  );
}
