// ⚠️ COPY THIS FILE INTO THE INSIDER PWA PROJECT (homedecorinsider).
// Then register the route in that project's src/App.tsx:
//   <Route path="/invite" element={<InviteAccept />} />

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

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
        if (error || !data?.email || !data?.password) {
          throw new Error(error?.message || data?.error || "Invite expired or invalid");
        }

        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password,
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
