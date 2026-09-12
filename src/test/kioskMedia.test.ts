import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIOSK_MEDIA_ACCEPT, detectUploadType, mediaTypeOf, probeVideo } from "@/lib/kioskMedia";

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

describe("probeVideo", () => {
  const fakeVideo = () => {
    const el: Record<string, unknown> = {
      preload: "", muted: false, videoWidth: 0, duration: 0,
      onloadedmetadata: null, onerror: null,
      removeAttribute: () => {}, load: () => {},
    };
    // Setting src is what kicks a real <video> into loading.
    return el as unknown as HTMLVideoElement;
  };

  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:probe",
      revokeObjectURL: () => {},
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const blob = () => new Blob(["x"], { type: "video/mp4" });

  it("accepts a clip whose metadata decodes to a real frame size", async () => {
    const el = fakeVideo();
    const p = probeVideo(blob(), { createElement: () => el });
    Object.assign(el, { videoWidth: 1920, duration: 12.5 });
    el.onloadedmetadata?.(new Event("loadedmetadata"));
    await expect(p).resolves.toEqual({ ok: true, durationSeconds: 12.5 });
  });

  it("rejects a container the browser cannot decode", async () => {
    const el = fakeVideo();
    const p = probeVideo(blob(), { createElement: () => el });
    el.onerror?.(new Event("error"));
    await expect(p).resolves.toEqual({
      ok: false,
      reason: "uses a format this browser can't play",
    });
  });

  it("rejects an audio-only file that loads metadata but has no picture", async () => {
    const el = fakeVideo();
    const p = probeVideo(blob(), { createElement: () => el });
    el.onloadedmetadata?.(new Event("loadedmetadata"));
    await expect(p).resolves.toEqual({ ok: false, reason: "has no video track" });
  });

  it("gives up rather than hanging the upload form", async () => {
    vi.useFakeTimers();
    const p = probeVideo(blob(), { createElement: fakeVideo, timeoutMs: 100 });
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toEqual({ ok: false, reason: "took too long to open" });
    vi.useRealTimers();
  });

  it("ignores a late event once it has already settled", async () => {
    const el = fakeVideo();
    const p = probeVideo(blob(), { createElement: () => el });
    Object.assign(el, { videoWidth: 640, duration: 3 });
    el.onloadedmetadata?.(new Event("loadedmetadata"));
    el.onerror?.(new Event("error"));
    await expect(p).resolves.toEqual({ ok: true, durationSeconds: 3 });
  });
});
