import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const resolvePhotoUrl = vi.fn();
vi.mock("@/lib/photoUrls", () => ({ resolvePhotoUrl: (...args: unknown[]) => resolvePhotoUrl(...args) }));

import SignedImg, { SignedPhotoLink } from "@/components/SignedImg";

const SIGNED = "https://proj.supabase.co/storage/v1/object/sign/field-agent-photos/a.jpg?token=1";

beforeEach(() => {
  resolvePhotoUrl.mockReset();
});

describe("SignedImg", () => {
  it("renders the signed URL once resolved", async () => {
    resolvePhotoUrl.mockResolvedValue(SIGNED);
    render(<SignedImg src="a.jpg" alt="Photo 1" />);
    await waitFor(() => expect(screen.getByAltText("Photo 1")).toHaveAttribute("src", SIGNED));
  });

  it("shows a retryable placeholder instead of a broken image when signing fails", async () => {
    resolvePhotoUrl.mockResolvedValue(null);
    render(<SignedImg src="a.jpg" alt="Photo 1" />);

    const placeholder = await screen.findByRole("button", { name: /photo unavailable/i });
    expect(screen.queryByAltText("Photo 1")).not.toBeInTheDocument();

    resolvePhotoUrl.mockResolvedValue(SIGNED);
    fireEvent.click(placeholder);
    await waitFor(() => expect(screen.getByAltText("Photo 1")).toBeInTheDocument());
    expect(resolvePhotoUrl).toHaveBeenLastCalledWith("a.jpg", undefined, { force: true });
  });

  it("re-signs once when the browser rejects a stale signed URL", async () => {
    resolvePhotoUrl.mockResolvedValue(SIGNED);
    render(<SignedImg src="a.jpg" alt="Photo 1" />);
    const img = await screen.findByAltText("Photo 1");

    fireEvent.error(img);
    await waitFor(() =>
      expect(resolvePhotoUrl).toHaveBeenLastCalledWith("a.jpg", undefined, { force: true }),
    );
  });

  it("renders nothing for an empty value", () => {
    const { container } = render(<SignedImg src="" alt="none" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SignedPhotoLink", () => {
  it("points the link at the signed URL", async () => {
    resolvePhotoUrl.mockResolvedValue(SIGNED);
    render(<SignedPhotoLink src="a.jpg" alt="Photo 1" />);
    await waitFor(() => expect(screen.getByAltText("Photo 1").closest("a")).toHaveAttribute("href", SIGNED));
  });
});
