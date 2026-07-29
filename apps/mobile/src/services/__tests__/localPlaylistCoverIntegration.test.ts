import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function hasJsxAttributeBinding(
  source: string,
  tagName: string,
  attributeName: string,
  identifierName: string,
): boolean {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;

  const visit = (node: ts.Node) => {
    if (found) return;
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (openingElement?.tagName.getText(sourceFile) === tagName) {
      const attribute = openingElement.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(sourceFile) === attributeName,
      );
      const expression = attribute?.initializer && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : null;
      found = !!expression && ts.isIdentifier(expression) && expression.text === identifierName;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function hasVariablePropertyBinding(
  source: string,
  variableName: string,
  objectName: string,
  propertyName: string,
): boolean {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
      && node.initializer
      && ts.isPropertyAccessExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === objectName
      && node.initializer.name.text === propertyName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

describe("local playlist cover integration", () => {
  it("routes imported local playlist covers through list and shared detail rendering", () => {
    const listSource = readSource("src/components/LocalPlaylistList.tsx");
    const detailSource = readSource("src/screens/LocalPlaylistDetailScreen.tsx");
    const detailHeroSource = readSource("src/components/DetailHero.tsx");

    expect(hasVariablePropertyBinding(listSource, "coverUrl", "playlist", "cover")).toBe(true);
    expect(hasJsxAttributeBinding(listSource, "CachedImage", "uri", "coverUrl")).toBe(true);

    expect(hasVariablePropertyBinding(detailSource, "coverUrl", "playlist", "cover")).toBe(true);
    expect(hasJsxAttributeBinding(detailSource, "DetailHero", "imageUrl", "coverUrl")).toBe(true);

    expect(hasJsxAttributeBinding(detailHeroSource, "CachedImage", "uri", "imageUrl")).toBe(true);
  });

  it("does not accept matching attributes from unrelated JSX elements", () => {
    const misleadingDetail = [
      "const decoy = <View imageUrl={coverUrl} />;",
      "const hero = <DetailHero imageUrl={otherCover} />;",
    ].join("\n");
    const misleadingHero = [
      "const decoy = <View uri={imageUrl} />;",
      "const image = <CachedImage uri={otherImage} />;",
    ].join("\n");
    const misleadingVariable = [
      "const coverUrl = other.cover;",
      "const decoy = playlist.cover;",
    ].join("\n");

    expect(hasJsxAttributeBinding(misleadingDetail, "DetailHero", "imageUrl", "coverUrl")).toBe(false);
    expect(hasJsxAttributeBinding(misleadingHero, "CachedImage", "uri", "imageUrl")).toBe(false);
    expect(hasVariablePropertyBinding(misleadingVariable, "coverUrl", "playlist", "cover")).toBe(false);
  });
});
