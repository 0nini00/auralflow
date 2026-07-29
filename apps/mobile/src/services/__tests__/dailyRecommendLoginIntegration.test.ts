import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("daily recommend login integration", () => {
  it("offers a login modal entry when daily recommendations require account login", () => {
    const source = readFileSync(resolve(process.cwd(), "src/screens/DailyRecommendScreen.tsx"), "utf8");

    expect(source).toContain("Modal,");
    expect(source).toContain("import { LoginScreen } from \"@/screens/LoginScreen\";");
    expect(source).toContain("const [showLoginModal, setShowLoginModal] = useState(false);");
    expect(source).toContain("onPress={() => setShowLoginModal(true)}");
    expect(source).toContain("登录账号");
    expect(source).toContain("visible={showLoginModal}");
    expect(source).toContain("onRequestClose={() => setShowLoginModal(false)}");
    expect(source).toContain("<LoginScreen onSuccess={() => setShowLoginModal(false)} />");
  });
});
