/**
 * Media helpers for the kiosk screensaver.
 *
 * The screensaver plays a mix of still scheme banners and looping videos, so
 * every row has to say which it is. `media_type` carries that, but rows
 * uploaded before videos existed have no value at all — those fall back to the
 * file extension so an old banner never renders into a <video> tag.
 */

export type KioskMediaType = "image" | "video";

/** Formats a browser can decode from a canvas and paint on the kiosk. */
export const KIOSK_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** Formats Chrome on the kiosk plays without a codec pack. `.mov` is deliberately absent. */
export const KIOSK_VIDEO_MIME = ["video/mp4", "video/webm"] as const;

/** `accept` for the admin upload input. */
export const KIOSK_MEDIA_ACCEPT = [...KIOSK_IMAGE_MIME, ...KIOSK_VIDEO_MIME].join(",");

/** Videos skip canvas compression, so the raw file is what the kiosk downloads. */
export const MAX_VIDEO_MB = 50;

const VIDEO_EXTENSION_RE = /\.(mp4|webm|m4v|mov|ogv)(?:[?#]|$)/i;

/** What the kiosk should render for a stored row. */
export function mediaTypeOf(row: { media_type?: string | null; image_url?: string | null }): KioskMediaType {
  if (row.media_type === "video") return "video";
  if (row.media_type === "image") return "image";
  return VIDEO_EXTENSION_RE.test(row.image_url ?? "") ? "video" : "image";
}

/** What a picked file should be uploaded as — `null` when the kiosk can't show it. */
export function detectUploadType(file: { type: string; name: string }): KioskMediaType | null {
  const type = file.type.toLowerCase();
  if ((KIOSK_IMAGE_MIME as readonly string[]).includes(type)) return "image";
  if ((KIOSK_VIDEO_MIME as readonly string[]).includes(type)) return "video";
  // Android's file picker hands over an empty type often enough to matter.
  if (!type && VIDEO_EXTENSION_RE.test(file.name)) return "video";
  return null;
}
