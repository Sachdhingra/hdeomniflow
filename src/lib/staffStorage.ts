import { supabase } from "@/integrations/supabase/client";

export const MAX_PROFILE_PIC_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_PIC_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadProfilePicture(userId: string, file: File): Promise<string> {
  if (!ACCEPTED_PIC_TYPES.includes(file.type)) {
    throw new Error("Only JPG, PNG, or WebP images are allowed");
  }
  if (file.size > MAX_PROFILE_PIC_BYTES) {
    throw new Error("Image must be under 5MB");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/profile-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("staff-profiles")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("staff-profiles").getPublicUrl(path);
  return data.publicUrl;
}
