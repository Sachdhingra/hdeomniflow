import { Copy, Link2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/lib/toast";

// The public website. Each salesperson shares it with their own ?ref= code, and the
// website-lead function assigns enquiries from that link to them.
export const PUBLIC_SITE_URL = "https://hdefurniture.netlify.app";

export const websiteLink = (code: string) => `${PUBLIC_SITE_URL}/?ref=${encodeURIComponent(code)}`;

export async function copyWebsiteLink(code: string, name?: string) {
  const link = websiteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    toast.success(name ? `${name}'s website link copied` : "Website link copied");
  } catch {
    window.prompt("Copy this link", link);
  }
}

interface Props {
  code: string | null | undefined;
  name: string;
}

/** "My website link" card on the salesperson's dashboard. */
const WebsiteLinkCard = ({ code, name }: Props) => {
  if (!code) return null;
  const link = websiteLink(code);
  const shareText = `Hi, this is ${name} from Home Decor Enterprises. Browse our furniture and send me an enquiry here: ${link}`;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          My website link
        </p>
        <p className="text-xs text-muted-foreground">
          Send customers this link. Every enquiry they make on the website comes straight to you.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-background border rounded px-2 py-1 break-all">{link}</code>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => copyWebsiteLink(code)}>
            <Copy className="w-3 h-3" />Copy
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs bg-success hover:bg-success/90 text-success-foreground" asChild>
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="w-3 h-3" />Share on WhatsApp
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default WebsiteLinkCard;
