# Insider App — Profile Screen: Anniversary Date Field

Add these blocks to the **Profile** screen in the Insider Lovable PWA, following the same pattern as the existing **Date of Birth** card.

---

## 1. State & save handler

```tsx
// Add alongside the existing dobValue / dobSaving state
const [annivValue, setAnnivValue] = useState<string>("");
const [annivSaving, setAnnivSaving] = useState(false);

// Load anniversary_date when customer row loads
// (wherever you fetch elite_customers data for the profile)
// e.g. setAnnivValue(customer.anniversary_date ?? "");

const saveAnniversaryDate = async () => {
  if (!annivValue) return;
  setAnnivSaving(true);
  const { error } = await supabase.rpc("rpc_set_anniversary_date", {
    p_date: annivValue,          // "YYYY-MM-DD"
  });
  setAnnivSaving(false);
  if (error) {
    toast({ title: "Could not save", description: error.message, variant: "destructive" });
  } else {
    toast({ title: "Anniversary date saved", description: "You'll receive a bonus on this date every year." });
  }
};
```

---

## 2. JSX — insert after the Date of Birth card

```tsx
{/* ── Card Anniversary Date ── */}
<div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
  <div>
    <h3 className="font-semibold text-gray-900">Card Anniversary Date</h3>
    <p className="text-sm text-gray-500 mt-0.5">
      We'll credit you{" "}
      {customerTier === "prestige_elite" ? "50" : "25"} bonus points on
      this date every year as a thank-you for being a member.
    </p>
  </div>

  <div className="flex gap-3 items-center">
    <input
      type="date"
      value={annivValue}
      max={new Date().toISOString().slice(0, 10)}   // no future dates
      onChange={(e) => setAnnivValue(e.target.value)}
      className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm
                 focus:outline-none focus:ring-2 focus:ring-amber-500"
    />
    <button
      onClick={saveAnniversaryDate}
      disabled={annivSaving || !annivValue}
      className="bg-amber-700 text-white font-medium px-5 py-2.5 rounded-xl
                 text-sm disabled:opacity-50 active:scale-95 transition-transform"
    >
      {annivSaving ? "Saving…" : "Save"}
    </button>
  </div>

  {annivValue && (
    <p className="text-xs text-gray-400">
      Next bonus: {nextAnniversaryLabel(annivValue)}
    </p>
  )}
</div>
```

---

## 3. Helper — next anniversary label

```tsx
function nextAnniversaryLabel(isoDate: string): string {
  const today = new Date();
  const ann   = new Date(isoDate);
  const next  = new Date(today.getFullYear(), ann.getMonth(), ann.getDate());
  if (next <= today) next.setFullYear(next.getFullYear() + 1);
  return next.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
```

---

## 4. What happens automatically (no further app code needed)

| Trigger | Action |
|---|---|
| Customer sets anniversary date | Saved to `elite_customers.anniversary_date` via `rpc_set_anniversary_date` |
| Daily cron at 08:00 IST | `fn_award_anniversary_bonus()` fires; credits **25 pts** (Super Elite) or **50 pts** (Prestige Elite) if today matches their anniversary date |
| Same cron run | Push notification: *"Happy Card Anniversary! 🎉 … X bonus loyalty points added to your wallet"* |
| `card_enrollment_date` already set by staff | Used automatically as fallback if customer hasn't set `anniversary_date` |

---

## 5. Supabase fetch — include anniversary_date when loading profile

```tsx
const { data: customer } = await supabase
  .from("elite_customers")
  .select("id, customer_name, card_tier, card_number, card_expiry_date, date_of_birth, anniversary_date")
  .eq("id", customerId)
  .single();

// Then seed the state:
setAnnivValue(customer?.anniversary_date ?? "");
```
