import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, User } from "lucide-react";
import { uploadProfilePicture } from "@/lib/staffStorage";
import type { StaffProfile } from "@/hooks/useStaffProfile";

const DESIGNATIONS = [
  "Sales Executive", "Senior Sales Executive", "Sales Manager",
  "Service Executive", "Service Head", "Field Agent", "Site Agent",
  "Accounts Executive", "Admin", "Other"
];

const STATES = [
  "Delhi", "Haryana", "Uttar Pradesh", "Punjab", "Rajasthan", "Maharashtra",
  "Gujarat", "Karnataka", "Tamil Nadu", "West Bengal", "Other"
];

export interface ProfileFormProps {
  initial?: StaffProfile | null;
  requireAll?: boolean;
  onSaved?: (p: StaffProfile) => void;
  submitLabel?: string;
}

export default function ProfileForm({ initial, requireAll, onSaved, submitLabel = "Save Profile" }: ProfileFormProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    full_name: initial?.full_name || user?.name || "",
    phone: initial?.phone || "",
    date_of_birth: initial?.date_of_birth || "",
    joining_date: initial?.joining_date || "",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    pincode: initial?.pincode || "",
    designation: initial?.designation || "",
    bio: initial?.bio || "",
    profile_picture_url: initial?.profile_picture_url || "",
  });

  useEffect(() => {
    if (initial) {
      setForm({
        full_name: initial.full_name || "",
        phone: initial.phone || "",
        date_of_birth: initial.date_of_birth || "",
        joining_date: initial.joining_date || "",
        address: initial.address || "",
        city: initial.city || "",
        state: initial.state || "",
        pincode: initial.pincode || "",
        designation: initial.designation || "",
        bio: initial.bio || "",
        profile_picture_url: initial.profile_picture_url || "",
      });
    }
  }, [initial]);

  const setField = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handlePick = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const url = await uploadProfilePicture(user.id, file);
      setField("profile_picture_url", url);
      toast({ title: "Picture uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (requireAll) {
      const required: (keyof typeof form)[] = ["full_name", "phone", "date_of_birth", "joining_date", "city", "state", "designation"];
      for (const k of required) {
        if (!form[k]) {
          toast({ title: "Please complete all required fields", description: k.replace(/_/g, " "), variant: "destructive" });
          return;
        }
      }
    }

    setSaving(true);
    const isComplete = Boolean(
      form.full_name && form.phone && form.date_of_birth && form.joining_date &&
      form.city && form.state && form.designation
    );

    const payload = {
      user_id: user.id,
      email: user.email,
      full_name: form.full_name,
      phone: form.phone || null,
      date_of_birth: form.date_of_birth || null,
      joining_date: form.joining_date || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      pincode: form.pincode || null,
      designation: form.designation || null,
      bio: form.bio || null,
      profile_picture_url: form.profile_picture_url || null,
      is_profile_complete: isComplete,
    };

    const { data, error } = await (supabase
      .from("staff_profiles" as any)
      .upsert(payload as any, { onConflict: "user_id" })
      .select()
      .single() as any);

    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Profile saved" });
    onSaved?.(data as StaffProfile);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar className="w-20 h-20">
          <AvatarImage src={form.profile_picture_url || undefined} />
          <AvatarFallback><User className="w-8 h-8" /></AvatarFallback>
        </Avatar>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />
          <Button type="button" variant="outline" onClick={handlePick} disabled={uploading}>
            {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</> : <><Upload className="w-4 h-4 mr-2" />Upload picture</>}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">JPG/PNG/WebP, max 5MB</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Full name *</Label>
          <Input value={form.full_name} onChange={e => setField("full_name", e.target.value)} required />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={user?.email || ""} readOnly disabled />
        </div>
        <div>
          <Label>Phone *</Label>
          <Input value={form.phone} onChange={e => setField("phone", e.target.value)} />
        </div>
        <div>
          <Label>Date of birth *</Label>
          <Input type="date" value={form.date_of_birth} onChange={e => setField("date_of_birth", e.target.value)} />
        </div>
        <div>
          <Label>Joining date *</Label>
          <Input type="date" value={form.joining_date} onChange={e => setField("joining_date", e.target.value)} />
        </div>
        <div>
          <Label>Designation *</Label>
          <Select value={form.designation} onValueChange={v => setField("designation", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {DESIGNATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Address</Label>
          <Input value={form.address} onChange={e => setField("address", e.target.value)} />
        </div>
        <div>
          <Label>City *</Label>
          <Input value={form.city} onChange={e => setField("city", e.target.value)} />
        </div>
        <div>
          <Label>State *</Label>
          <Select value={form.state} onValueChange={v => setField("state", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pincode</Label>
          <Input value={form.pincode} onChange={e => setField("pincode", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Bio</Label>
          <Textarea value={form.bio} onChange={e => setField("bio", e.target.value.slice(0, 200))} rows={3} placeholder="Short intro (max 200 chars)" />
          <p className="text-xs text-muted-foreground mt-1">{form.bio.length}/200</p>
        </div>
      </div>

      <Button type="submit" disabled={saving || uploading} className="w-full md:w-auto">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : submitLabel}
      </Button>
    </form>
  );
}
