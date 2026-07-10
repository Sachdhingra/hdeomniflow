import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase: any = _supabase;

export interface SetupTokenResponse {
  token: string;
  customerId: string;
  expiresAt: string;
  qrCodeUrl: string;
  deepLink: string;
}

/**
 * Generate a setup token for a customer
 * This token can be encoded in a QR code or shared as a deep link
 */
export async function generateSetupToken(customerId: string): Promise<SetupTokenResponse | null> {
  try {
    const { data: token, error } = await supabase.rpc("generate_setup_token", {
      _customer_id: customerId,
    });

    if (error || !token) {
      console.error("Failed to generate setup token:", error);
      return null;
    }

    // Build the setup URLs
    const baseUrl = window.location.origin;
    const deepLink = `${baseUrl}/setup?setup=${encodeURIComponent(token)}`;

    // Generate QR code using a public service
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(deepLink)}`;

    return {
      token,
      customerId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      qrCodeUrl,
      deepLink,
    };
  } catch (err) {
    console.error("Error generating setup token:", err);
    return null;
  }
}

/**
 * Format setup token for easy sharing (e.g., WhatsApp, SMS)
 */
export function formatSetupMessage(setupResponse: SetupTokenResponse): string {
  const baseUrl = window.location.origin;
  const setupUrl = `${baseUrl}/setup?setup=${encodeURIComponent(setupResponse.token)}`;

  return `Welcome to Home Decor Insider! 🎉

Click this link to set up your device and access your Elite Card instantly:
${setupUrl}

Setup expires in 24 hours.
Questions? Visit ${baseUrl}`;
}

/**
 * Get customer details for setup (admin only)
 */
export async function getCustomerForSetup(
  customerId: string,
): Promise<{ id: string; customer_name: string; phone_1: string } | null> {
  try {
    const { data, error } = await supabase
      .from("elite_customers")
      .select("id, customer_name, phone_1")
      .eq("id", customerId)
      .eq("status", "active")
      .single();

    if (error) {
      console.error("Failed to fetch customer:", error);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Error fetching customer:", err);
    return null;
  }
}

/**
 * List active device credentials for a customer (admin/customer view)
 */
export async function listCustomerDevices(customerId: string) {
  try {
    const { data, error } = await supabase
      .from("device_credentials")
      .select("id, device_name, device_id, created_at, last_used_at, revoked_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to list devices:", error);
      return [];
    }

    return data;
  } catch (err) {
    console.error("Error listing devices:", err);
    return [];
  }
}

/**
 * Revoke a specific device credential (logout from device)
 */
export async function revokeDeviceCredential(deviceToken: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("revoke_device_token", {
      _device_token: deviceToken,
    });

    if (error) {
      console.error("Failed to revoke device:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error revoking device:", err);
    return false;
  }
}
