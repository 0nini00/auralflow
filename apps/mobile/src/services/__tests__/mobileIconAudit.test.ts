import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const extendedPictographicPattern = /\p{Extended_Pictographic}/gu;
const textArrowPattern = /[\u2039\u203A\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F]/gu;
const prohibitedTextGlyphs = new Set([
  "\u002B",
  "\u2039",
  "\u203A",
  "\u22EF",
  "\u2304",
  "\u23EE",
  "\u23ED",
  "\u23F8",
  "\u25B6",
  "\u25C0",
  "\u2630",
  "\u2661",
]);

function listProductionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : listProductionSourceFiles(path);
      }
      if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) {
        return [];
      }
      return [path];
    })
    .sort();
}

function displayPath(filePath: string): string {
  return relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function auditSource(sourcePath: string, source: string): string[] {
  const filePath = resolve(process.cwd(), sourcePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];

  const report = (position: number, reason: string) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
    violations.push(`${displayPath(filePath)}:${line + 1}:${character + 1} ${reason}`);
  };

  for (const match of source.matchAll(extendedPictographicPattern)) {
    report(match.index, "contains an Emoji or extended pictograph");
  }

  interface RenderedLiteral {
    value: string;
    position: number;
    standalone: boolean;
  }

  const collectExpressionLiterals = (
    node: ts.Expression,
    literals: RenderedLiteral[],
    standalone: boolean,
  ) => {
    if (ts.isStringLiteralLike(node)) {
      literals.push({ value: node.text, position: node.getStart(sourceFile) + 1, standalone });
      return;
    }
    if (ts.isNumericLiteral(node)) {
      literals.push({ value: node.text, position: node.getStart(sourceFile), standalone });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      literals.push({
        value: node.head.text,
        position: node.head.getStart(sourceFile) + 1,
        standalone: false,
      });
      for (const span of node.templateSpans) {
        collectExpressionLiterals(span.expression, literals, false);
        literals.push({
          value: span.literal.text,
          position: span.literal.getStart(sourceFile) + 1,
          standalone: false,
        });
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collectExpressionLiterals(node.whenTrue, literals, standalone);
      collectExpressionLiterals(node.whenFalse, literals, standalone);
      return;
    }
    if (
      ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)
    ) {
      collectExpressionLiterals(node.expression, literals, standalone);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const renderedOperators = new Set([
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.PlusToken,
      ]);
      if (!renderedOperators.has(node.operatorToken.kind)) return;
      const combinesText = node.operatorToken.kind === ts.SyntaxKind.PlusToken;
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
        collectExpressionLiterals(node.left, literals, standalone && !combinesText);
      }
      collectExpressionLiterals(node.right, literals, standalone && !combinesText);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isExpression(element)) {
          collectExpressionLiterals(element, literals, standalone && node.elements.length === 1);
        }
      }
    }
  };

  const collectRenderedLiterals = (
    node: ts.JsxChild,
    literals: RenderedLiteral[],
    standalone: boolean,
  ) => {
    if (ts.isJsxText(node)) {
      literals.push({ value: node.getText(sourceFile), position: node.getStart(sourceFile), standalone });
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) collectExpressionLiterals(node.expression, literals, standalone);
      return;
    }
    if (ts.isJsxFragment(node)) {
      node.children.forEach((child) =>
        collectRenderedLiterals(child, literals, standalone && node.children.length === 1));
    }
  };

  const hasSemanticIconStyle = (node: ts.JsxElement): boolean => {
    const styleAttribute = node.openingElement.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "style",
    );
    if (!styleAttribute || !styleAttribute.initializer || !ts.isJsxExpression(styleAttribute.initializer)) {
      return false;
    }

    const styleNames: string[] = [];
    const collectStyleNames = (styleNode: ts.Node) => {
      if (ts.isPropertyAccessExpression(styleNode)) {
        if (ts.isIdentifier(styleNode.expression) && /styles?$/i.test(styleNode.expression.text)) {
          styleNames.push(styleNode.name.text);
        }
        return;
      }
      if (ts.isIdentifier(styleNode)) {
        styleNames.push(styleNode.text);
        return;
      }
      if (ts.isArrayLiteralExpression(styleNode)) {
        styleNode.elements.forEach(collectStyleNames);
        return;
      }
      if (ts.isConditionalExpression(styleNode)) {
        collectStyleNames(styleNode.whenTrue);
        collectStyleNames(styleNode.whenFalse);
        return;
      }
      if (ts.isBinaryExpression(styleNode)) {
        if (styleNode.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
          collectStyleNames(styleNode.left);
        }
        collectStyleNames(styleNode.right);
        return;
      }
      if (ts.isParenthesizedExpression(styleNode)) {
        collectStyleNames(styleNode.expression);
      }
    };
    if (styleAttribute.initializer.expression) {
      collectStyleNames(styleAttribute.initializer.expression);
    }
    return styleNames.some((name) => /icon|glyph|symbol|arrow/i.test(name));
  };

  const inspectTextElement = (node: ts.JsxElement) => {
    const literals: RenderedLiteral[] = [];
    node.children.forEach((child) =>
      collectRenderedLiterals(child, literals, node.children.length === 1));

    for (const literal of literals) {
      const trimmedValue = literal.value.trim();
      if (literal.standalone && trimmedValue === "AF") {
        report(literal.position, "uses the prohibited AF text fallback");
      }
      if (literal.standalone && prohibitedTextGlyphs.has(trimmedValue)) {
        report(literal.position, "uses a Unicode text glyph as a UI icon");
      }
      for (const match of literal.value.matchAll(textArrowPattern)) {
        report(literal.position + match.index, "uses a text arrow in rendered UI");
      }
    }

    if (hasSemanticIconStyle(node)) {
      const staticLiteral = literals.find((literal) => literal.value.trim().length > 0);
      if (staticLiteral) {
        report(staticLiteral.position, "uses static text in an icon-style Text element");
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === "Text") {
      inspectTextElement(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function auditSourceFile(filePath: string): string[] {
  return auditSource(filePath, readFileSync(filePath, "utf8"));
}

describe("mobile icon audit", () => {
  it("uses semantic vector icons across every production TypeScript source", () => {
    const files = listProductionSourceFiles(sourceRoot);
    const violations = files.flatMap(auditSourceFile);

    expect(files.length).toBeGreaterThan(0);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("backs action menu items with one typed Lucide icon map", () => {
    const source = readFileSync(resolve(sourceRoot, "components/ActionMenuSheet.tsx"), "utf8");

    expect(source).toContain("export type ActionMenuIconKey");
    expect(source).toContain("icon?: ActionMenuIconKey");
    expect(source).toMatch(/const ACTION_MENU_ICONS:\s*Record<ActionMenuIconKey,\s*LucideIcon>/);
  });

  it("reports direct, conditional, and template arrows rendered by Text", () => {
    const violations = auditSource(
      "src/fixtures/renderedArrows.tsx",
      [
        "const forward = true;",
        "const suffix = '目标';",
        "export function Fixture() {",
        "  return <>",
        "    <Text>前进 →</Text>",
        "    <Text>{forward ? '后退 ←' : '停留'}</Text>",
        "    <Text>{`继续 → ${suffix}`}</Text>",
        "  </>;",
        "}",
      ].join("\n"),
    );

    expect(violations).toHaveLength(3);
    for (const violation of violations) {
      expect(violation).toMatch(
        /^src\/fixtures\/renderedArrows\.tsx:\d+:\d+ uses a text arrow in rendered UI$/,
      );
    }
  });

  it("ignores arrows in comments, nested attributes, and dynamic text", () => {
    const violations = auditSource(
      "src/fixtures/allowedArrows.tsx",
      [
        "export function Fixture({ label, user }) {",
        "  return <>",
        "    <Pressable><Text style={styles.buttonText}>返回</Text></Pressable>",
        "    <Text style={[styles.buttonText, { color: iconColor }]}>普通文字</Text>",
        "    <Text style={styles.avatarFallbackText}>{user.nickname.charAt(0)}</Text>",
        "    <Text>{/* 注释 → */}<Icon accessibilityLabel='后退 ←' />{label}</Text>",
        "    <Text>{value > 0 ? `+${value}` : `${value}`}dB</Text>",
        "  </>;",
        "}",
      ].join("\n"),
    );

    expect(violations).toEqual([]);
  });

  it("rejects static rendered text styled as an icon", () => {
    const violations = auditSource(
      "src/fixtures/staticTextIcon.tsx",
      "export function Fixture() { return <Pressable><Text style={styles.playIcon}>播放</Text></Pressable>; }",
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^src\/fixtures\/staticTextIcon\.tsx:\d+:\d+ uses static text in an icon-style Text element$/,
    );
  });

  it("uses a Lucide account icon for the logged-out account card", () => {
    const source = readFileSync(resolve(sourceRoot, "components/AccountInfo.tsx"), "utf8");

    expect(source).toContain("<UserRound");
    expect(source).not.toContain("loginIconText");
  });
});
