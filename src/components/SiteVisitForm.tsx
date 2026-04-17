import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useData, LEAD_CATEGORIES, LeadCategory } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MapPin, Camera, Loader2, X, Locate } from "lucide-react";
import { toast } from "sonner";

interface SiteVisitFormProps {
  trigger?: React.ReactNode;
}

const SiteVisitForm = ({ trigger }: SiteVisitFormProps) => {
  const { user } = useAuth();
  const { addSiteVisit } = useData();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GPS state
  const [gpsLoading, setGpsLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number; ts: string } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Photos
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const [form, setForm] = useState({
    location: "", society: "", notes: "",
    customerName: "", customerPhone: "",
    category: "" as LeadCategory | "",
    budget: "", followUpDate: "", visitStatus: "new",
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation not supported on this device");
      toast.error("Geolocation not supported");
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const c = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: new Date().toISOString(),
        };
        setCoords(c);
        setGpsLoading(false);
        toast.success("Location captured");
      },
      err => {
        setGpsLoading(false);
        const msg = err.code === err.PERMISSION_DENIED
          ? "Permission denied. Enable location in browser settings."
          : err.code === err.POSITION_UNAVAILABLE
          ? "Position unavailable. Try outdoors with GPS on."
          : "Could not get location. Try again.";
        setGpsError(msg);
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!user) { toast.error("Not authenticated"); return; }

    setUploadingPhotos(true);
    const newUrls: string[] = [];

    for (const file of files) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("field-agent-photos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("field-agent-photos").getPublicUrl(path);
        if (data?.publicUrl) newUrls.push(data.publicUrl);
      } catch (err: any) {
        console.error("Photo upload failed:", err);
        toast.error(`Upload failed: ${err.message || "Unknown error"}`);
      }
    }

    if (newUrls.length > 0) {
      setPhotoUrls(prev => [...prev, ...newUrls]);
      toast.success(`${newUrls.length} photo${newUrls.length > 1 ? "s" : ""} uploaded`);
    }
    setUploadingPhotos(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = async (url: string) => {
    setPhotoUrls(prev => prev.filter(u => u !== url));
    try {
      const path = url.split("/field-agent-photos/")[1]?.split("?")[0];
      if (path) await supabase.storage.from("field-agent-photos").remove([path]);
    } catch {}
  };

  const reset = () => {
    setForm({ location: "", society: "", notes: "", customerName: "", customerPhone: "", category: "", budget: "", followUpDate: "", visitStatus: "new" });
    setCoords(null);
    setPhotoUrls([]);
    setGpsError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.location.trim()) { toast.error("Location required"); return; }
    setSubmitting(true);
    try {
      await addSiteVisit({
        agent_id: user?.id || "",
        location: form.location,
        society: form.society,
        date: todayStr,
        photos: photoUrls,
        photo_url: photoUrls[0] || null,
        notes: form.notes,
        leads_generated: form.customerName ? 1 : 0,
        customer_name: form.customerName || null,
        customer_phone: form.customerPhone || null,
        category: (form.category as LeadCategory) || null,
        budget: form.budget ? Number(form.budget) : null,
        follow_up_date: form.followUpDate || null,
        status: form.visitStatus,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        accuracy_meters: coords?.accuracy ?? null,
        gps_timestamp: coords?.ts ?? null,
      } as any);
      toast.success("Site visit logged!");
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to log visit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2 min-h-[44px]">
            <MapPin className="w-4 h-4" />Log Site Visit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Log Site Visit</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* GPS section */}
          <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">GPS Location</Label>
              <Button
                type="button"
                size="sm"
                variant={coords ? "outline" : "default"}
                onClick={captureLocation}
                disabled={gpsLoading}
                className="gap-1 h-8"
              >
                {gpsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Locate className="w-3 h-3" />}
                {coords ? "Capture Again" : "Capture Location"}
              </Button>
            </div>
            {gpsLoading && <p className="text-xs text-muted-foreground">📍 Getting your location...</p>}
            {coords && (
              <p className="text-xs text-success">
                {coords.lat.toFixed(4)}° N, {coords.lng.toFixed(4)}° E (±{Math.round(coords.accuracy)}m)
              </p>
            )}
            {gpsError && <p className="text-xs text-destructive">{gpsError}</p>}
            {!coords && !gpsLoading && !gpsError && (
              <p className="text-xs text-muted-foreground">Tap to capture coordinates. Enable GPS for best accuracy.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Location / Area *</Label>
            <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Area / Address" />
          </div>
          <div className="space-y-1.5">
            <Label>Society / Community</Label>
            <Input value={form.society} onChange={e => setForm(f => ({ ...f, society: e.target.value }))} placeholder="Society name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Customer Name</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Contact Number</Label><Input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category Interest</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as LeadCategory }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Budget (₹)</Label><Input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Follow-up Date</Label><Input type="date" value={form.followUpDate} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.visitStatus} onValueChange={v => setForm(f => ({ ...f, visitStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="interested">Interested</SelectItem>
                  <SelectItem value="not_interested">Not Interested</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Photos */}
          <div className="space-y-1.5">
            <Label>Site Photos</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-3 text-center">
              <Camera className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoSelect}
                disabled={uploadingPhotos}
              />
              {uploadingPhotos && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
                </p>
              )}
            </div>
            {photoUrls.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {photoUrls.map((url, i) => (
                  <div key={url} className="relative">
                    <img src={url} alt={`Site ${i + 1}`} className="w-16 h-16 rounded object-cover border border-border" loading="lazy" />
                    <button
                      type="button"
                      onClick={() => removePhoto(url)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs"
                      aria-label="Remove photo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>

          <Button type="submit" disabled={submitting || uploadingPhotos} className="w-full gradient-primary min-h-[44px]">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Visit"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SiteVisitForm;
