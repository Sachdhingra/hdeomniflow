import { describe, expect, it } from "vitest";
import { KIOSK_MEDIA_ACCEPT, detectUploadType, mediaTypeOf } from "@/lib/kioskMedia";

describe("mediaTypeOf", () => {
  it("trusts a stored media_type", () => {
    expect(mediaTypeOf({ media_type: "video", image_url: "x.jpg" })).toBe("video");
    expect(mediaTypeOf({ media_type: "image", image_url: "x.mp4" })).toBe("image");
  });

  it("falls back to the extension for rows uploaded before videos existed", () => {
    expect(mediaTypeOf({ media_type: null, image_url: "https://x/y/promo.mp4" })).toBe("video");
    expect(mediaTypeOf({ image_url: "https://x/y/diwali.png" })).toBe("image");
  });

  it("reads the extension past a signed-URL query string", () => {
    expect(mediaTypeOf({ image_url: "https://x/y/promo.webm?token=abc" })).toBe("video");
  });

  it("treats an unknown or missing url as an image rather than an empty <video>", () => {
    expect(mediaTypeOf({ image_url: "" })).toBe("image");
    expect(mediaTypeOf({ image_url: "https://x/y/banner" })).toBe("image");
  });
});

describe("detectUploadType", () => {
  it("classifies the formats the kiosk can show", () => {
    expect(detectUploadType({ type: "image/png", name: "a.png" })).toBe("image");
    expect(detectUploadType({ type: "video/mp4", name: "a.mp4" })).toBe("video");
    expect(detectUploadType({ type: "VIDEO/WEBM", name: "a.webm" })).toBe("video");
  });

  it("rejects what the kiosk cannot decode", () => {
    expect(detectUploadType({ type: "image/heic", name: "a.heic" })).toBeNull();
    expect(detectUploadType({ type: "video/quicktime", name: "a.mov" })).toBeNull();
    expect(detectUploadType({ type: "application/pdf", name: "a.pdf" })).toBeNull();
  });

  it("falls back to the name when the picker gives no mime type", () => {
    expect(detectUploadType({ type: "", name: "clip.mp4" })).toBe("video");
    expect(detectUploadType({ type: "", name: "notes.txt" })).toBeNull();
  });
});

describe("KIOSK_MEDIA_ACCEPT", () => {
  it("offers both images and videos in the file picker", () => {
    expect(KIOSK_MEDIA_ACCEPT).toContain("image/png");
    expect(KIOSK_MEDIA_ACCEPT).toContain("video/mp4");
  });
});
