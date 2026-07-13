import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, RefreshCw, Check, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Public URL of the Insider PWA — the QR/link opens its setup page
const INSIDER_APP_URL = "https://homedecorinsider.lovable.app";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  customerName?: string;
  phone?: string;
}

const InviteQRDialog = ({ open, onOpenChange, customerId, customerName }: Props) => {
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!customerId) return;
    setLoading(true);
    setLink(null);
    setDataUrl(null);
    try {
      const { data: token, error } = await (supabase as any).rpc("generate_setup_token", {
        _customer_id: customerId,
      });
      if (error || !token) throw new Error(error?.message || "Failed to create setup code");

      const setupLink = `${INSIDER_APP_URL}/setup?setup=${encodeURIComponent(token)}`;
      setLink(setupLink);
      const png = await QRCode.toDataURL(setupLink, { width: 480, margin: 2 });
      setDataUrl(png);
    } catch (e: any) {
      toast.error(e?.message || "Could not generate QR");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) generate();
    else { setLink(null); setDataUrl(null); setCopied(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Setup link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const shareLink = async () => {
    if (!link) return;
    const message = `Welcome to Home Decor Insider! 🎉\n\nOpen this link on your phone to set up your Elite Card app:\n${link}\n\nThe link works once and expires in 24 hours.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Home Decor Insider Setup", text: message });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(message);
      toast.success("Message copied — paste it in WhatsApp/SMS");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Insider App Setup{customerName ? ` — ${customerName}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {loading && (
            <div className="h-[280px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && dataUrl && (
            <>
              <div className="rounded-xl bg-white p-3 border">
                <img src={dataUrl} alt="Insider setup QR" className="w-[260px] h-[260px]" />
              </div>
              <p className="text-sm text-center text-muted-foreground max-w-xs">
                Ask the customer to scan with their phone camera. The Insider app opens,
                shows their name, and asks for their password to finish setup.
                One-time use, valid for 24 hours.
              </p>
              <div className="flex gap-2 w-full">
                <Button variant="outline" size="sm" className="flex-1" onClick={copyLink}>
                  {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                  Copy link
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={shareLink}>
                  <Share2 className="w-4 h-4 mr-1" />
                  Share
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={generate}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  New code
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InviteQRDialog;
