// ⚠️ COPY THIS FILE INTO THE INSIDER PWA PROJECT (homedecorinsider).
// Then register the route in that project's src/App.tsx:
//   <Route path="/invite" element={<InviteAccept />} />

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const inviteErrorMessage = (code?: string) => {
  if (code === "already_used") return "This invite link has already been used. Open the app directly or ask for a new one.";
  if (code === "expired") return "This invite link has expired. Please ask for a new link.";
  return "Invalid invite link. Please check the link and try again.";
};

export default function InviteAccept() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState("Setting up your account…");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setMsg("Invalid invite link.");
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("redeem-invite", {
          body: { token },
        });

        if (error || !data?.hashed_token) {
          let code = data?.error;
          const ctx = (error as { context?: Response } | null)?.context;
          if (!code && ctx && typeof ctx.json === "function") {
            try { code = (await ctx.json())?.error; } catch {}
          }
          throw new Error(inviteErrorMessage(code));
        }

        const { error: signInErr } = await supabase.auth.verifyOtp({
          token_hash: data.hashed_token,
          type: "email",
        });
        if (signInErr) throw signInErr;

        navigate("/", { replace: true });
      } catch (e: any) {
        setMsg(e.message || "Could not redeem invite");
      }
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{msg}</p>
    </div>
  );
}
