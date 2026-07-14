import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  audioBase64ToBlob,
  GEMINI_VOICES,
  DEFAULT_VOICE,
  VOICE_REMINDER_ROLES,
} from "@/lib/voiceReminder";

describe("voiceReminder", () => {
  it("decodes base64 to the original bytes", () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const b64 = btoa(String.fromCharCode(...original));
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(original));
  });

  it("builds an audio blob with the given mime type", () => {
    const b64 = btoa("RIFFxxxx");
    const blob = audioBase64ToBlob(b64, "audio/wav");
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(8);
  });

  it("has the default voice in the voice list", () => {
    expect(GEMINI_VOICES.some(v => v.id === DEFAULT_VOICE)).toBe(true);
  });

  it("only allows sales, service, admin and accounts roles", () => {
    expect([...VOICE_REMINDER_ROLES].sort()).toEqual(
      ["accounts", "admin", "sales", "service_head"].sort(),
    );
  });
});
