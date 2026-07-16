import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("login screen QR integration", () => {
  const source = readFileSync(
    resolve(__dirname, "../../screens/LoginScreen.tsx"),
    "utf8",
  );
  const accountStoreSource = readFileSync(
    resolve(__dirname, "../../stores/accountStore.ts"),
    "utf8",
  );

  it("uses the shared QR login component and saves the returned cookie through account login", () => {
    expect(source).toContain("import { QrLoginView } from \"@/components/QrLoginView\";");
    expect(source).toContain("const handleQrSuccess = async (qrCookie: string) => {");
    expect(source).toContain("await login(qrCookie);");
    expect(source).toContain("<QrLoginView");
    expect(source).toContain("onSuccess={(qrCookie) => void handleQrSuccess(qrCookie)}");
  });

  it("does not keep a second QR polling state machine inside LoginScreen", () => {
    expect(source).not.toContain("createQrLogin");
    expect(source).not.toContain("pollQrLogin");
    expect(source).not.toContain("beginPolling");
  });

  it("keeps QR login generation and polling out of the account store", () => {
    expect(accountStoreSource).not.toContain("getQrCodeKey");
    expect(accountStoreSource).not.toContain("getQrCodeUrl");
    expect(accountStoreSource).not.toContain("checkQrLoginStatus");
    expect(accountStoreSource).not.toContain("createQrLogin");
    expect(accountStoreSource).not.toContain("pollQrLogin");
  });
});
