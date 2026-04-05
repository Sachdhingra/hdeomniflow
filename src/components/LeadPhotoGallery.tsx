import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Camera } from "lucide-react";

interface LeadPhotoGalleryProps {
  leadId: string;
  className?: string;
}

const LeadPhotoGallery = ({ leadId, className = "" }: LeadPhotoGalleryProps) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPhotos = async () => {
      setLoading(true);
      try {
        // Find service jobs linked to this lead
        const { data: jobs } = await supabase
          .from("service_jobs")
          .select("photos")
          .eq("source_lead_id", leadId)
          .is("deleted_at", null);

        const allPhotos: string[] = [];
        if (jobs) {
          for (const job of jobs) {
            if (job.photos && Array.isArray(job.photos)) {
              for (const photo of job.photos) {
                if (photo) {
                  const { data } = supabase.storage.from("job-photos").getPublicUrl(photo);
                  if (data?.publicUrl) allPhotos.push(data.publicUrl);
                }
              }
            }
          }
        }
        setPhotos(allPhotos);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };

    if (leadId) fetchPhotos();
  }, [leadId]);

  if (loading || photos.length === 0) return null;

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-center gap-1 mb-1">
        <Camera className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{photos.length} photo{photos.length > 1 ? "s" : ""}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {photos.slice(0, 4).map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`Photo ${i + 1}`}
            className="w-12 h-12 rounded object-cover cursor-pointer border border-border hover:ring-2 hover:ring-primary/50 transition-all"
            loading="lazy"
            onClick={(e) => { e.stopPropagation(); setSelectedPhoto(url); }}
          />
        ))}
        {photos.length > 4 && (
          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
            +{photos.length - 4}
          </div>
        )}
      </div>
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-lg p-2">
          {selectedPhoto && (
            <img src={selectedPhoto} alt="Full size" className="w-full rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadPhotoGallery;
