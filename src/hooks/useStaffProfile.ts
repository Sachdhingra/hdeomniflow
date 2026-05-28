import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  joining_date: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  profile_picture_url: string | null;
  department: string | null;
  designation: string | null;
  bio: string | null;
  is_profile_complete: boolean;
  created_at: string;
  updated_at: string;
}

export function useStaffProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("staff_profiles" as any)
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    setProfile((data as any) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { profile, loading, refresh: fetchProfile };
}
