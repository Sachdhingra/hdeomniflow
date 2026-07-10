import { useState } from "react";
import { toast } from "sonner";
import {
  generateSetupToken,
  formatSetupMessage,
  getCustomerForSetup,
  listCustomerDevices,
} from "@/lib/device-setup";
import { Copy, QrCode, Share2, RotateCw, Trash2 } from "lucide-react";

interface DeviceSetupAdminProps {
  customerId: string;
  onClose?: () => void;
}

export function DeviceSetupAdmin({ customerId, onClose }: DeviceSetupAdminProps) {
  const [loading, setLoading] = useState(false);
  const [setupToken, setSetupToken] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [deepLink, setDeepLink] = useState<string>("");
  const [devices, setDevices] = useState<any[]>([]);
  const [showQR, setShowQR] = useState(false);

  // Generate new setup token
  const handleGenerateToken = async () => {
    setLoading(true);
    try {
      const result = await generateSetupToken(customerId);
      if (result) {
        setSetupToken(result.token);
        setQrCodeUrl(result.qrCodeUrl);
        setDeepLink(result.deepLink);
        toast.success("Setup token generated successfully");
        // Load devices
        const customerDevices = await listCustomerDevices(customerId);
        setDevices(customerDevices);
      } else {
        toast.error("Failed to generate setup token");
      }
    } finally {
      setLoading(false);
    }
  };

  // Copy to clipboard
  const handleCopyLink = () => {
    navigator.clipboard.writeText(deepLink);
    toast.success("Link copied to clipboard");
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(setupToken);
    toast.success("Token copied to clipboard");
  };

  // Share message
  const handleShare = async () => {
    if (!setupToken) return;

    const message = formatSetupMessage({
      token: setupToken,
      customerId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      qrCodeUrl,
      deepLink,
    });

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Home Decor Insider Setup",
          text: message,
        });
      } catch (err) {
        console.log("Share cancelled");
      }
    } else {
      navigator.clipboard.writeText(message);
      toast.success("Message copied to clipboard");
    }
  };

  // Refresh devices list
  const handleRefreshDevices = async () => {
    const customerDevices = await listCustomerDevices(customerId);
    setDevices(customerDevices);
    toast.success("Devices updated");
  };

  return (
    <div className="space-y-6 p-6 bg-card rounded-lg border">
      <div>
        <h3 className="text-lg font-semibold mb-4">Device Setup Management</h3>

        {/* Generate Token Section */}
        <div className="space-y-4 mb-6 pb-6 border-b">
          <h4 className="font-medium text-sm">Generate Setup Token</h4>
          <p className="text-sm text-muted-foreground">
            Create a one-time setup link or QR code for passwordless authentication.
          </p>

          <button
            onClick={handleGenerateToken}
            disabled={loading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Setup Token"}
          </button>
        </div>

        {/* Setup Token Display */}
        {setupToken && (
          <div className="space-y-4 mb-6 pb-6 border-b">
            <h4 className="font-medium text-sm">Setup Link & QR Code</h4>

            {/* Deep Link */}
            <div className="bg-muted p-3 rounded-lg">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 break-all text-xs font-mono text-muted-foreground">
                  {deepLink}
                </div>
                <button
                  onClick={handleCopyLink}
                  className="p-1 hover:bg-background rounded text-muted-foreground hover:text-foreground"
                  title="Copy link"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Token */}
            <div className="bg-muted p-3 rounded-lg">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 break-all text-xs font-mono text-muted-foreground">
                  {setupToken}
                </div>
                <button
                  onClick={handleCopyToken}
                  className="p-1 hover:bg-background rounded text-muted-foreground hover:text-foreground"
                  title="Copy token"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* QR Code */}
            <button
              onClick={() => setShowQR(!showQR)}
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <QrCode className="h-4 w-4" />
              {showQR ? "Hide" : "Show"} QR Code
            </button>

            {showQR && (
              <div className="bg-background p-4 rounded-lg text-center">
                <img
                  src={qrCodeUrl}
                  alt="Setup QR Code"
                  className="w-40 h-40 mx-auto"
                  title="Scan this QR code with your device"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Scan with device camera or QR scanner
                </p>
              </div>
            )}

            {/* Share Button */}
            <button
              onClick={handleShare}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
            >
              <Share2 className="h-4 w-4" />
              Share Setup Link
            </button>

            {/* Note */}
            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              ⚠️ This setup token expires in 24 hours and can only be used once.
            </p>
          </div>
        )}

        {/* Active Devices */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-sm">Active Devices</h4>
            <button
              onClick={handleRefreshDevices}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
              title="Refresh devices"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>

          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices registered yet.</p>
          ) : (
            <div className="space-y-2">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex justify-between items-start p-3 bg-muted rounded-lg text-sm"
                >
                  <div className="flex-1">
                    <p className="font-medium">{device.device_name || "Unknown Device"}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {device.device_id?.substring(0, 8)}...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added: {new Date(device.created_at).toLocaleDateString()}
                    </p>
                    {device.last_used_at && (
                      <p className="text-xs text-muted-foreground">
                        Last used: {new Date(device.last_used_at).toLocaleDateString()}
                      </p>
                    )}
                    {device.revoked_at && (
                      <p className="text-xs text-red-500">Revoked on {new Date(device.revoked_at).toLocaleDateString()}</p>
                    )}
                  </div>
                  {!device.revoked_at && (
                    <button
                      onClick={() => {
                        // TODO: Implement revoke functionality
                        toast.info("Revoke device functionality coming soon");
                      }}
                      className="p-1 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-500"
                      title="Revoke device"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="w-full px-4 py-2 text-sm border rounded-lg hover:bg-muted"
        >
          Close
        </button>
      )}
    </div>
  );
}
