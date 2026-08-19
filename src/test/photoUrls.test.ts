import { describe, it, expect, beforeEach, vi } from "vitest";

const createSignedUrl = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, expiresIn: number) => createSignedUrl(bucket, path, expiresIn) }) },
  },
}));

import {
  parseStorageUrl,
  photoCandidates,
  isDirectlyRenderable,
  resolvePhotoUrl,
  __resetPhotoUrlCache,
} from "@/lib/photoUrls";

const PUBLIC_URL =
  "https://proj.supabase.co/storage/v1/object/public/field-agent-photos/jobs/abc/1.jpg";
const SIGNED_URL =
  "https://proj.supabase.co/storage/v1/object/sign/field-agent-photos/jobs/abc/1.jpg?token=xyz";

const ok = (url: string) => ({ data: { signedUrl: url }, error: null });
const fail = () => ({ data: null, error: { message: "Object not found" } });

beforeEach(() => {
  __resetPhotoUrlCache();
  createSignedUrl.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseStorageUrl", () => {
  it("reads bucket and path out of a public URL", () => {
    expect(parseStorageUrl(PUBLIC_URL)).toEqual({ bucket: "field-agent-photos", path: "jobs/abc/1.jpg" });
  });

  it("reads a signed URL, dropping the token", () => {
    expect(parseStorageUrl(SIGNED_URL)).toEqual({ bucket: "field-agent-photos", path: "jobs/abc/1.jpg" });
  });

  it("decodes escaped path segments", () => {
    const url = "https://proj.supabase.co/storage/v1/object/public/job-photos/jobs/a%20b/1.jpg";
    expect(parseStorageUrl(url)).toEqual({ bucket: "job-photos", path: "jobs/a b/1.jpg" });
  });

  it("ignores non-storage URLs", () => {
    expect(parseStorageUrl("https://example.com/photo.jpg")).toBeNull();
  });
});

describe("photoCandidates", () => {
  it("puts the URL's own bucket first and keeps the others as fallbacks", () => {
    expect(photoCandidates(PUBLIC_URL)).toEqual([
      { bucket: "field-agent-photos", path: "jobs/abc/1.jpg" },
      { bucket: "job-photos", path: "jobs/abc/1.jpg" },
    ]);
  });

  it("tries the hinted bucket first for a bare path", () => {
    expect(photoCandidates("jobs/abc/1.jpg", "job-photos").map(c => c.bucket)).toEqual([
      "job-photos",
      "field-agent-photos",
    ]);
  });

  it("returns nothing for external and empty values", () => {
    expect(photoCandidates("https://example.com/a.jpg")).toEqual([]);
    expect(photoCandidates("")).toEqual([]);
  });
});

describe("isDirectlyRenderable", () => {
  it("is true for external URLs only", () => {
    expect(isDirectlyRenderable("https://example.com/a.jpg")).toBe(true);
    expect(isDirectlyRenderable("data:image/png;base64,AAA")).toBe(true);
    expect(isDirectlyRenderable(PUBLIC_URL)).toBe(false);
    expect(isDirectlyRenderable("jobs/abc/1.jpg")).toBe(false);
  });
});

describe("resolvePhotoUrl", () => {
  it("signs a legacy public URL against its own bucket", async () => {
    createSignedUrl.mockResolvedValueOnce(ok(SIGNED_URL));
    await expect(resolvePhotoUrl(PUBLIC_URL)).resolves.toBe(SIGNED_URL);
    expect(createSignedUrl).toHaveBeenCalledWith("field-agent-photos", "jobs/abc/1.jpg", 3600);
  });

  it("falls back to the other photo bucket when the first has no such object", async () => {
    createSignedUrl.mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok(SIGNED_URL));
    const url = "https://proj.supabase.co/storage/v1/object/public/job-photos/jobs/abc/1.jpg";
    await expect(resolvePhotoUrl(url)).resolves.toBe(SIGNED_URL);
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, "field-agent-photos", "jobs/abc/1.jpg", 3600);
  });

  it("signs bare storage paths", async () => {
    createSignedUrl.mockResolvedValueOnce(ok(SIGNED_URL));
    await expect(resolvePhotoUrl("jobs/abc/1.jpg", "field-agent-photos")).resolves.toBe(SIGNED_URL);
  });

  it("returns null instead of an unusable URL when signing fails everywhere", async () => {
    createSignedUrl.mockResolvedValue(fail());
    await expect(resolvePhotoUrl(PUBLIC_URL)).resolves.toBeNull();
  });

  it("does not re-sign a value that just failed", async () => {
    createSignedUrl.mockResolvedValue(fail());
    await resolvePhotoUrl(PUBLIC_URL);
    const calls = createSignedUrl.mock.calls.length;
    await resolvePhotoUrl(PUBLIC_URL);
    expect(createSignedUrl.mock.calls.length).toBe(calls);
  });

  it("reuses a cached signed URL, and re-signs when forced", async () => {
    createSignedUrl.mockResolvedValue(ok(SIGNED_URL));
    await resolvePhotoUrl(PUBLIC_URL);
    await resolvePhotoUrl(PUBLIC_URL);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    await resolvePhotoUrl(PUBLIC_URL, undefined, { force: true });
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("passes external URLs straight through", async () => {
    await expect(resolvePhotoUrl("https://example.com/a.jpg")).resolves.toBe("https://example.com/a.jpg");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns null for empty values", async () => {
    await expect(resolvePhotoUrl("")).resolves.toBeNull();
  });
});
