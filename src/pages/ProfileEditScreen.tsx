import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStaffProfile } from "@/hooks/useStaffProfile";
import ProfileForm from "@/components/staff/ProfileForm";
import { Loader2 } from "lucide-react";

export default function ProfileEditScreen() {
  const { profile, loading, refresh } = useStaffProfile();

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Edit Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm initial={profile} onSaved={() => refresh()} submitLabel="Save Changes" />
        </CardContent>
      </Card>
    </div>
  );
}
