import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function directive(name: string): string[] {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";
  const entry = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

describe("index.html Content-Security-Policy", () => {
  it("lets OneSignal load its app config", () => {
    // The v16 page SDK fetches https://api.onesignal.com/sync/<appId>/web as
    // JSONP (a <script>). Blocking it leaves init() hanging with no config.
    expect(directive("script-src")).toContain("https://api.onesignal.com");
  });

  it("lets OneSignal load its SDK bundle", () => {
    expect(directive("script-src")).toContain("https://cdn.onesignal.com");
  });
});
