import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, User, Search, Phone, Mail } from "lucide-react";

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  profile_picture_url: string | null;
  joining_date: string | null;
  city: string | null;
}

export default function StaffDirectory() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("staff_profiles" as any)
        .select("id, full_name, email, phone, designation, profile_picture_url, joining_date, city")
        .order("full_name");
      setRows((data as any) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter(r =>
    !q || r.full_name.toLowerCase().includes(q.toLowerCase()) ||
    r.designation?.toLowerCase().includes(q.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex-1">Staff Directory</h1>
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or role…" className="pl-9" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No staff profiles found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(r => (
            <Card key={r.id}>
              <CardContent className="pt-6 flex flex-col items-center text-center">
                <Avatar className="w-20 h-20 mb-3">
                  <AvatarImage src={r.profile_picture_url || undefined} />
                  <AvatarFallback><User className="w-8 h-8" /></AvatarFallback>
                </Avatar>
                <p className="font-semibold">{r.full_name}</p>
                <p className="text-xs text-muted-foreground">{r.designation || "—"}</p>
                {r.city && <p className="text-xs text-muted-foreground mt-1">{r.city}</p>}
                <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                  {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-foreground"><Phone className="w-3 h-3" />{r.phone}</a>}
                  <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-foreground"><Mail className="w-3 h-3" />Email</a>
                </div>
                {r.joining_date && <p className="text-[10px] text-muted-foreground mt-2">Joined {new Date(r.joining_date).toLocaleDateString()}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
