import { useStaffProfile } from "@/hooks/useStaffProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Loader2, User, Mail, Phone, MapPin, Calendar, Briefcase } from "lucide-react";

export default function ProfileViewScreen() {
  const { profile, loading } = useStaffProfile();

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <p className="text-muted-foreground mb-4">No profile yet.</p>
        <Link to="/profile/edit"><Button>Set up profile</Button></Link>
      </div>
    );
  }

  const Row = ({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) =>
    value ? (
      <div className="flex items-start gap-3 py-2">
        <div className="text-muted-foreground mt-0.5">{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium">{value}</p>
        </div>
      </div>
    ) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <Avatar className="w-28 h-28">
              <AvatarImage src={profile.profile_picture_url || undefined} />
              <AvatarFallback><User className="w-12 h-12" /></AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{profile.full_name}</h1>
              <p className="text-muted-foreground">{profile.designation || "—"}</p>
              {profile.bio && <p className="mt-3 text-sm">{profile.bio}</p>}
              <Link to="/profile/edit"><Button variant="outline" className="mt-4">Edit Profile</Button></Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Row icon={<Mail className="w-4 h-4" />} label="Email" value={profile.email} />
          <Row icon={<Phone className="w-4 h-4" />} label="Phone" value={profile.phone} />
          <Row icon={<Calendar className="w-4 h-4" />} label="Date of birth" value={profile.date_of_birth} />
          <Row icon={<Briefcase className="w-4 h-4" />} label="Joined" value={profile.joining_date} />
          <Row icon={<MapPin className="w-4 h-4" />} label="Address" value={[profile.address, profile.city, profile.state, profile.pincode].filter(Boolean).join(", ")} />
        </CardContent>
      </Card>
    </div>
  );
}
