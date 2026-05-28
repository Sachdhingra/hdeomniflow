import { ReactNode } from "react";
import { useStaffProfile } from "@/hooks/useStaffProfile";
import ProfileSetupModal from "./ProfileSetupModal";
import { useLocation } from "react-router-dom";

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { profile, loading, refresh } = useStaffProfile();
  const location = useLocation();
  const needsSetup = !loading && (!profile || !profile.is_profile_complete);
  // Allow the dedicated setup route to render without modal duplication
  const onSetupRoute = location.pathname === "/profile/setup";

  return (
    <>
      {children}
      {needsSetup && !onSetupRoute && (
        <ProfileSetupModal open initial={profile} onComplete={refresh} />
      )}
    </>
  );
}
