import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { Check, Loader2, Maximize2, MessageCircle } from "lucide-react";
import GoogleReviewQRCode from "@/components/GoogleReviewQRCode";
import KioskScreensaver from "@/components/kiosk/KioskScreensaver";

type Step = 1 | 2 | 3 | 4;

/** Matches REVIEW_ASK_MIN_RATING in supabase/functions/_shared/kiosk-messages.ts */
const REVIEW_ASK_MIN_RATING = 4;

const firstNameOf = (full: string) => {
  const part = full.trim().split(/\s+/)[0] || "";
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : "there";
};

const EMOJIS_OVERALL = ["😢", "😕", "😐", "😊", "🤩"];
const EMOJIS_STAFF = ["😢", "😕", "😐", "😊", "⭐"];
const LABELS = ["Poor", "OK", "Good", "Great", "Amazing"];
const SALESPEOPLE = ["Shivam", "Nisha", "Reena", "Amit", "Saurabh", "Swati"];

const AUTO_RESET_SECONDS = 60;
// Writing a Google review takes longer than reading a thank-you screen, so the
// review step gets more room before the kiosk resets for the next customer.
const REVIEW_RESET_SECONDS = 180;

const EmojiRow = ({
  emojis,
  selected,
  onSelect,
}: {
  emojis: string[];
  selected: number | null;
  onSelect: (n: number) => void;
}) => (
  <div className="grid grid-cols-5 gap-2 sm:gap-3 w-full max-w-2xl">
    {emojis.map((e, i) => {
      const value = i + 1;
      const active = selected === value;
      return (
        <button
          key={i}
          onClick={() => onSelect(value)}
          className={`aspect-square rounded-2xl bg-white/15 backdrop-blur border-2 transition-all flex flex-col items-center justify-center text-4xl sm:text-5xl active:scale-95 hover:scale-105 ${
            active ? "border-white scale-105 bg-white/30" : "border-white/30"
          }`}
          aria-label={LABELS[i]}
        >
          <span>{e}</span>
          <span className="text-xs sm:text-sm mt-1 font-medium text-white/90">{LABELS[i]}</span>
        </button>
      );
    })}
  </div>
);

const StepDot = ({ active }: { active: boolean }) => (
  <span className={`h-2 rounded-full transition-all ${active ? "w-8 bg-white" : "w-2 bg-white/40"}`} />
);

const FeedbackKiosk = () => {
  const [step, setStep] = useState<Step>(1);
  const [overall, setOverall] = useState<number | null>(null);
  const [staff, setStaff] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [salesperson, setSalesperson] = useState<string>("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewUrl, setReviewUrl] = useState<string>("");
  const [businessPhone, setBusinessPhone] = useState<string>("");
  const [drawEnabled, setDrawEnabled] = useState(true);
  const [drawPrize, setDrawPrize] = useState<string>("");
  const [minDrawEntries, setMinDrawEntries] = useState<number>(50);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [confirmingReview, setConfirmingReview] = useState(false);
  const [countdown, setCountdown] = useState<number>(AUTO_RESET_SECONDS);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef<number>(AUTO_RESET_SECONDS);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key,value")
      .in("key", [
        "google_review_url",
        "business_phone",
        "monthly_draw_enabled",
        "monthly_draw_min_entries",
        "monthly_draw_prize",
      ])
      .then(({ data }) => {
        data?.forEach((r: any) => {
          if (r.key === "google_review_url") setReviewUrl(r.value);
          if (r.key === "business_phone") setBusinessPhone(r.value);
          if (r.key === "monthly_draw_enabled") setDrawEnabled(String(r.value).toLowerCase() !== "false");
          if (r.key === "monthly_draw_prize") setDrawPrize(r.value);
          if (r.key === "monthly_draw_min_entries") {
            const n = parseInt(r.value, 10);
            if (Number.isFinite(n) && n > 0) setMinDrawEntries(n);
          }
        });
      });
  }, []);

  const reset = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setStep(1);
    setOverall(null);
    setStaff(null);
    setName("");
    setPhone("");
    setSalesperson("");
    setComments("");
    setFeedbackId(null);
    setReviewConfirmed(false);
    setConfirmingReview(false);
    setCountdown(AUTO_RESET_SECONDS);
  };

  // Auto-reset after 5 min of inactivity on steps 1–3
  useEffect(() => {
    if (step === 4) return;
    let timer = window.setTimeout(reset, 5 * 60 * 1000);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reset, 5 * 60 * 1000);
    };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [step]);

  const handleOverall = (n: number) => {
    setOverall(n);
    setTimeout(() => setStep(2), 250);
  };
  const handleStaff = (n: number) => {
    setStaff(n);
    setTimeout(() => setStep(3), 250);
  };

  const enterFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      toast.error("Fullscreen not available");
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Please enter your name");
    if (!/^\d{10}$/.test(phone)) return toast.error("WhatsApp number must be 10 digits");
    if (!salesperson) return toast.error("Please select the salesperson who helped you");
    if (overall == null || staff == null) return;

    setSubmitting(true);
    // The insert trigger queues the personalised WhatsApp thank-you and pokes
    // the feedback-whatsapp function, so the message lands on the customer's
    // phone within seconds of them tapping Submit.
    const { data, error } = await (supabase as any).rpc("submit_kiosk_feedback", {
      p_customer_name: name.trim(),
      p_customer_phone: phone,
      p_overall_rating: overall,
      p_staff_rating: staff,
      p_salesperson_name: salesperson,
      p_comments: comments.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Could not submit. " + error.message);
      return;
    }
    setFeedbackId((data as string) ?? null);
    setStep(4);

    // Start countdown for auto-reset
    const seconds = overall >= REVIEW_ASK_MIN_RATING ? REVIEW_RESET_SECONDS : AUTO_RESET_SECONDS;
    setCountdown(seconds);
    remainingRef.current = seconds;
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      remainingRef.current -= 1;
      setCountdown(remainingRef.current);
      if (remainingRef.current <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        reset();
      }
    }, 1000);
  };

  // Someone still tapping around the thank-you screen is not finished with it —
  // give them the full countdown back rather than resetting under their hands.
  useEffect(() => {
    if (step !== 4) return;
    const bump = () => {
      const seconds =
        (overall ?? 0) >= REVIEW_ASK_MIN_RATING ? REVIEW_RESET_SECONDS : AUTO_RESET_SECONDS;
      remainingRef.current = seconds;
      setCountdown(seconds);
    };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, [step, overall]);

  useEffect(() => () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const confirmReview = async () => {
    if (!feedbackId) return;
    setConfirmingReview(true);
    const { error } = await (supabase as any).rpc("record_google_review", {
      p_feedback_id: feedbackId,
      p_source: "kiosk",
    });
    setConfirmingReview(false);
    if (error) {
      toast.error("Could not record that. " + error.message);
      return;
    }
    setReviewConfirmed(true);
    toast.success("You're entered into this month's lucky draw!");
  };

  const resultEmoji = useMemo(() => {
    if (overall === 5) return "🌟";
    if (overall === 4) return "😊";
    if (overall === 3) return "🙂";
    return "💪";
  }, [overall]);

  return (
    <div className="min-h-screen gradient-feedback flex flex-col items-center px-4 py-6 sm:py-10 relative">
      <button
        onClick={enterFullscreen}
        className="absolute top-3 right-3 text-white/80 hover:text-white p-2 rounded-lg bg-white/10 backdrop-blur"
        aria-label="Toggle fullscreen"
        title="Fullscreen"
      >
        <Maximize2 className="w-4 h-4" />
      </button>

      <header className="text-center text-white mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">OmniFlow Customer Feedback</h1>
        <p className="text-white/80 text-sm mt-1">We'd love to hear about your visit</p>
      </header>

      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((n) => (
          <StepDot key={n} active={step >= (n as Step)} />
        ))}
      </div>

      <main className="w-full max-w-2xl flex-1 flex flex-col items-center justify-start">
        {step === 1 && (
          <section className="w-full flex flex-col items-center gap-6 animate-fade-in">
            <h2 className="text-xl sm:text-2xl font-semibold text-white text-center">
              How was your visit overall?
            </h2>
            <EmojiRow emojis={EMOJIS_OVERALL} selected={overall} onSelect={handleOverall} />
          </section>
        )}

        {step === 2 && (
          <section className="w-full flex flex-col items-center gap-6 animate-fade-in">
            <h2 className="text-xl sm:text-2xl font-semibold text-white text-center">
              How was our staff?
            </h2>
            <EmojiRow emojis={EMOJIS_STAFF} selected={staff} onSelect={handleStaff} />
            <Button variant="ghost" className="text-white/80" onClick={() => setStep(1)}>
              ← Back
            </Button>
          </section>
        )}

        {step === 3 && (
          <section className="w-full max-w-md bg-white/95 rounded-3xl p-6 shadow-xl animate-scale-in">
            <h2 className="text-xl font-semibold mb-4 text-foreground">A few quick details</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="fb-name">Your name</Label>
                <Input id="fb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <div>
                <Label htmlFor="fb-phone">WhatsApp number (10 digits)</Label>
                <Input
                  id="fb-phone"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="9876543210"
                />
              </div>
              <div>
                <Label>Who helped you today?</Label>
                <Select value={salesperson} onValueChange={setSalesperson}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select salesperson" />
                  </SelectTrigger>
                  <SelectContent>
                    {SALESPEOPLE.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fb-comments">Comments (optional)</Label>
                <Textarea
                  id="fb-comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button className="flex-1" onClick={submit} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Feedback"}
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === 4 && overall != null && (
          <section className="w-full flex flex-col items-center gap-5 text-center text-white animate-fade-in">
            <div className="text-6xl">{resultEmoji}</div>
            {overall >= REVIEW_ASK_MIN_RATING ? (
              <div className="w-full max-w-md mx-auto flex flex-col items-center gap-3">
                <h2 className="text-xl sm:text-2xl font-bold">
                  Thank you for visiting, {firstNameOf(name)}!
                </h2>
                <p className="text-white/90 text-sm sm:text-base">
                  We wish to serve you better each day 💙
                </p>

                {reviewConfirmed ? (
                  <div className="w-full rounded-2xl bg-white/15 backdrop-blur border border-white/30 p-4 flex flex-col items-center gap-2">
                    <Check className="w-8 h-8" />
                    <p className="font-semibold">You're in this month's lucky draw! 🎁</p>
                    <p className="text-white/80 text-xs">
                      We'll announce the winner on WhatsApp in the first week of next month.
                    </p>
                  </div>
                ) : reviewUrl ? (
                  <>
                    <p className="text-white/90 text-sm">
                      ⭐ Would you take 30 seconds to leave us a Google review? Scan below.
                    </p>
                    <GoogleReviewQRCode url={reviewUrl} size={180} />
                    {drawEnabled && (
                      <p className="text-white/80 text-xs max-w-xs">
                        🎁 Every Google review enters you into our monthly lucky draw
                        {drawPrize ? ` — winner gets ${drawPrize}` : ""}. One winner is drawn in the
                        first week of each month, in any month with at least {minDrawEntries} review
                        entries.
                      </p>
                    )}
                    <Button
                      variant="secondary"
                      onClick={confirmReview}
                      disabled={confirmingReview || !feedbackId}
                      className="gap-2"
                    >
                      {confirmingReview ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      I've left my review
                    </Button>
                    <button
                      onClick={confirmReview}
                      disabled={confirmingReview || !feedbackId}
                      className="text-white/70 text-xs underline underline-offset-2"
                    >
                      I had already reviewed you earlier
                    </button>
                  </>
                ) : (
                  <p className="text-white/80">Review link not configured yet.</p>
                )}
              </div>
            ) : overall === 3 ? (
              <>
                <h2 className="text-2xl font-bold">Thank you for visiting, {firstNameOf(name)}!</h2>
                <p className="text-white/90">Your feedback helps us serve you better 😊</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold">We appreciate your honest feedback</h2>
                <p className="text-white/90">How can we do better? 💪</p>
                {businessPhone && (
                  <p className="text-white/80 text-sm">
                    Want to talk? Call us at <span className="font-semibold">{businessPhone}</span>
                  </p>
                )}
              </>
            )}

            <p className="text-white/80 text-xs flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              A thank-you message is on its way to your WhatsApp
            </p>

            <div className="mt-2 flex flex-col items-center gap-2">
              <div className="text-white/90 text-sm">
                Next customer in <span className="font-bold text-lg">{countdown}s</span>
              </div>
              <Button variant="secondary" onClick={reset}>
                Done — next customer
              </Button>
            </div>
          </section>
        )}
      </main>

      <KioskScreensaver />
    </div>
  );
};

export default FeedbackKiosk;
