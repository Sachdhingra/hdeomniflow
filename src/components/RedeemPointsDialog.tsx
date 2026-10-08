import { useCallback, useEffect, useRef, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { AlertTriangle, CheckCircle2, Clock, Gift, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "@/lib/toast";
import {
  cancelRedemption, describeClosed, describeStartError, fetchSession, inr,
  notifyCustomer, startRedemption, verifyRedemption,
  type SessionRow, type StartInfo, type VerifyResult,
} from "@/lib/redemption";

/**
 * Counter flow for redeeming loyalty points on a pending bill entry.
 *
 *   start  -> the customer is notified and picks an option in their app
 *   code   -> the customer reads out the 4-digit code shown in their app
 *   done   -> points, bill and request are updated in one step on the server
 *
 * Staff never type a rupee amount: the discount is whatever the customer chose
 * and the server allowed. The 5% limit is shown in rupees the whole time.
 */

export interface RedeemEntry {
  id: string;
  customer_id: string;
  customer_name?: string;
  gross_bill_amount: number;
}

interface Props {
  entry: RedeemEntry;
  open: boolean;
  onClose: () => void;
  /** called after points were actually redeemed, so the list can refresh */
  onChanged: () => void;
}

type Phase = "starting" | "blocked" | "waiting" | "code" | "done" | "closed";

const POLL_MS = 2500;

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function RedeemPointsDialog({ entry, open, onClose, onChanged }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [info, setInfo] = useState<StartInfo | null>(null);
  const [headroom, setHeadroom] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [chosen, setChosen] = useState<{ points: number; rupees: number } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [inline, setInline] = useState("");
  const [blocked, setBlocked] = useState<{ title: string; detail: string } | null>(null);
  const [closedWhy, setClosedWhy] = useState("");
  const [result, setResult] = useState<Extract<VerifyResult, { ok: true }> | null>(null);

  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("starting");
  const startedFor = useRef<string | null>(null);
  phaseRef.current = phase;

  const toPhase = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const applySession = useCallback((row: SessionRow | null) => {
    if (!row || phaseRef.current === "done") return;
    if (row.status === "awaiting_otp" && row.chosen_points) {
      setChosen({ points: row.chosen_points, rupees: Number(row.chosen_rupees) });
      setExpiresAt(new Date(row.expires_at).getTime());
      if (phaseRef.current !== "code") { setCode(""); toPhase("code"); }
    } else if (row.status === "awaiting_choice") {
      if (phaseRef.current === "code") { setChosen(null); toPhase("waiting"); }
    } else if (row.status === "verified") {
      toPhase("done");
    } else if (row.status === "expired" || row.status === "cancelled" || row.status === "failed") {
      setClosedWhy(describeClosed(row.status));
      toPhase("closed");
    }
  }, []);

  const begin = useCallback(async () => {
    sessionRef.current = null;
    setInfo(null); setChosen(null); setCode(""); setInline(""); setBlocked(null); setResult(null); setClosedWhy("");
    toPhase("starting");
    try {
      const s = await startRedemption(entry.id);
      sessionRef.current = s.session_id;
      setInfo(s);
      setHeadroom(Number(s.headroom));
      setExpiresAt(new Date(s.expires_at).getTime());
      toPhase("waiting");
      if (!s.resumed) notifyCustomer(s.customer_id ?? entry.customer_id, "redemption_started");
      fetchSession(s.session_id).then(applySession).catch(() => {});
    } catch (e) {
      setBlocked(describeStartError((e as { message?: string })?.message));
      toPhase("blocked");
    }
  }, [entry.id, entry.customer_id, applySession]);

  // start once per opening
  useEffect(() => {
    if (!open) { startedFor.current = null; return; }
    if (startedFor.current === entry.id) return;
    startedFor.current = entry.id;
    void begin();
  }, [open, entry.id, begin]);

  // poll the session while we are waiting on the customer
  useEffect(() => {
    if (!open || (phase !== "waiting" && phase !== "code")) return;
    const t = setInterval(() => {
      const id = sessionRef.current;
      if (id) fetchSession(id).then(applySession).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open, phase, applySession]);

  // countdown
  useEffect(() => {
    if (!open || (phase !== "waiting" && phase !== "code")) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, phase]);

  const remaining = expiresAt - now;
  useEffect(() => {
    if ((phase === "waiting" || phase === "code") && expiresAt > 0 && remaining <= 0) {
      setClosedWhy(describeClosed("expired"));
      toPhase("closed");
    }
  }, [phase, expiresAt, remaining]);

  const submit = async () => {
    const id = sessionRef.current;
    if (!id || code.length !== 4 || busy) return;
    setBusy(true); setInline("");
    try {
      const r = await verifyRedemption(id, code);
      if (r.ok) {
        setResult(r);
        setHeadroom(Number(r.headroom_left));
        toPhase("done");
        notifyCustomer(r.customer_id, "redemption_used", { rupees: Number(r.rupees), points: r.points });
        toast.success(`${inr(r.rupees)} redeemed for ${r.points} points`);
        onChanged();
      } else {
        // the repo is not in strict mode, so the union does not narrow by itself
        const f = r as Extract<VerifyResult, { ok: false }>;
        if (f.reason === "WRONG_CODE") {
          const left = f.attempts_left ?? 0;
          setInline(`Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`);
          setCode("");
        } else if (f.reason === "BAD_FORMAT") {
          setInline("Enter all 4 digits.");
        } else if (f.reason === "NOT_AWAITING_CODE") {
          fetchSession(id).then(applySession).catch(() => {});
        } else {
          setClosedWhy(describeClosed(f.reason));
          toPhase("closed");
        }
      }
    } catch (e) {
      const d = describeStartError((e as { message?: string })?.message);
      setInline([d.title, d.detail].filter(Boolean).join(": "));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const id = sessionRef.current;
    setBusy(true);
    try { if (id) await cancelRedemption(id); } catch { /* already closed */ }
    setBusy(false);
    onClose();
  };

  const cap = info ? Number(info.cap) : 0;
  const gross = Number(entry.gross_bill_amount) || 0;
  const pct = gross > 0 && cap > 0 ? Math.round((cap / gross) * 100) : 0;
  const used = Math.max(0, cap - headroom);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-amber-600" />
            Redeem points{entry.customer_name ? ` · ${entry.customer_name}` : ""}
          </DialogTitle>
          <DialogDescription>
            The customer chooses the amount in their app and reads you a 4-digit code. The discount is applied automatically.
          </DialogDescription>
        </DialogHeader>

        {info && (
          <div
            data-testid="cap-reminder"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-0.5"
          >
            <p className="font-semibold">
              Limit on this bill{pct ? ` (${pct}% of ${inr(gross)})` : ""}: {inr(cap)}
            </p>
            <p>
              Already redeemed {inr(used)} · <strong>{inr(headroom)} left</strong>
            </p>
          </div>
        )}

        {phase === "starting" && (
          <div data-testid="phase-starting" className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking eligibility…
          </div>
        )}

        {phase === "blocked" && blocked && (
          <div data-testid="phase-blocked" className="space-y-3">
            <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{blocked.title}</p>
                {blocked.detail && <p className="text-xs text-muted-foreground mt-0.5">{blocked.detail}</p>}
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
          </div>
        )}

        {phase === "waiting" && (
          <div data-testid="phase-waiting" className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <Smartphone className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm font-medium">Waiting for the customer to choose</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Ask them to open the Home Decor Insider app and pick how many points to redeem. A code will appear in their app.
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {mmss(remaining)} left
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline" className="flex-1" disabled={busy}
                onClick={() => notifyCustomer(info?.customer_id ?? entry.customer_id, "redemption_started")}
              >
                Remind customer
              </Button>
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={cancel}>Cancel</Button>
            </div>
          </div>
        )}

        {phase === "code" && chosen && (
          <div data-testid="phase-code" className="space-y-4">
            <div className="rounded-md bg-muted p-3 text-center">
              <p className="text-xs text-muted-foreground">Customer chose</p>
              <p className="text-lg font-bold">{chosen.points} pts → {inr(chosen.rupees)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-center flex items-center justify-center gap-1">
                <ShieldCheck className="w-4 h-4" /> Ask the customer for the 4-digit code in their app
              </p>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={4}
                  value={code}
                  onChange={(v) => { setCode(v); setInline(""); }}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode="numeric"
                  autoFocus
                  disabled={busy}
                  aria-label="4-digit customer code"
                  onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-14 w-12 text-xl" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {inline && <p role="alert" className="text-sm text-destructive text-center">{inline}</p>}
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> {mmss(remaining)} left · do not enter any discount by hand
              </p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={code.length !== 4 || busy} onClick={submit}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancel}>Cancel</Button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div data-testid="phase-done" className="space-y-4 text-center">
            <div className="flex flex-col items-center gap-1 py-2">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <p className="font-semibold">
                {result ? `${inr(result.rupees)} redeemed (${result.points} points)` : "Redeemed"}
              </p>
              <p className="text-xs text-muted-foreground">
                Applied to the bill. {inr(headroom)} of the limit is still available.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { startedFor.current = entry.id; void begin(); }}>
                Redeem another
              </Button>
              <Button className="flex-1" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}

        {phase === "closed" && (
          <div data-testid="phase-closed" className="space-y-3">
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{closedWhy}</p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => { startedFor.current = entry.id; void begin(); }}>Start again</Button>
              <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

