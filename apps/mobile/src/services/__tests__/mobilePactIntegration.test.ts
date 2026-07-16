import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile pact integration", () => {
  const appSource = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");

  it("checks the mobile pact state during startup and mounts the pact modal", () => {
    expect(appSource).toContain("import { MobilePactModal } from \"@/components/MobilePactModal\";");
    expect(appSource).toContain("hasAcceptedMobilePact()");
    expect(appSource).toContain("acceptMobilePact()");
    expect(appSource).toContain("<MobilePactModal");
    expect(appSource).toContain("visible={pactAccepted === false}");
  });
});
