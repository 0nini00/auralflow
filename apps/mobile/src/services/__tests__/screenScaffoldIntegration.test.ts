import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const screens = [
  "HomeScreen.tsx",
  "SearchScreen.tsx",
  "DailyRecommendScreen.tsx",
  "PersonalFmScreen.tsx",
  "LibraryScreen.tsx",
  "DownloadScreen.tsx",
] as const;

const expectedSharedStates: Record<(typeof screens)[number], readonly string[]> = {
  "HomeScreen.tsx": ["EmptyState"],
  "SearchScreen.tsx": ["LoadingState", "ErrorState", "EmptyState"],
  "DailyRecommendScreen.tsx": ["LoadingState", "ErrorState", "EmptyState"],
  "PersonalFmScreen.tsx": ["LoadingState", "ErrorState", "EmptyState"],
  "LibraryScreen.tsx": ["LoadingState", "ErrorState", "EmptyState"],
  "DownloadScreen.tsx": ["EmptyState"],
};

const verticalScrollCompositions = [
  ["SearchScreen.tsx", ["SongList", "ArtistResultList", "AlbumResultList", "PlaylistResultList"]],
  ["DailyRecommendScreen.tsx", ["SongList"]],
  ["LibraryScreen.tsx", ["SongList", "PlaylistList", "LocalPlaylistList"]],
  ["DownloadScreen.tsx", ["SongList"]],
] as const;

const composedRowContainers = [
  "SongList.tsx",
  "SearchResultSections.tsx",
  "PlaylistList.tsx",
  "LocalPlaylistList.tsx",
] as const;

const rootDetailScreens = [
  "ArtistDetailScreen.tsx",
  "AlbumDetailScreen.tsx",
  "PlaylistDetailScreen.tsx",
  "LocalPlaylistDetailScreen.tsx",
  "BiliCollectionDetailScreen.tsx",
  "LikedSongsScreen.tsx",
  "SearchFallbackDetailScreen.tsx",
] as const;

const specialDetailScreens = [
  ["CustomSourceScreen.tsx", "返回设置"],
  ["LyricSettingsScreen.tsx", "关闭歌词设置"],
] as const;

const detailScreens = [
  ...rootDetailScreens,
  ...specialDetailScreens.map(([name]) => name),
] as const;

const artworkDetailScreens = [
  [
    "ArtistDetailScreen.tsx",
    "heroImageUrl",
    "heroTitle",
    ["artistInfo.songCount", "songs.length", "artistAlbumCount", "artist.songCount"],
    ["handlePlayAll", "handleShufflePlay", "handleLocateCurrentSong"],
    "successfulDetail",
  ],
  [
    "AlbumDetailScreen.tsx",
    "heroImageUrl",
    "heroTitle",
    ["albumInfo.publishTime", "albumInfo.trackCount", "songs.length", "album.trackCount"],
    ["handleOpenArtist", "handlePlayAll", "handleShufflePlay", "handleLocateCurrentSong"],
    "successfulDetail",
  ],
  [
    "PlaylistDetailScreen.tsx",
    "coverUrl",
    "displayPlaylist.name",
    ["songs.length", "displayPlaylist.trackCount", "displayPlaylist.playCount"],
    [
      "handlePlayAll",
      "handleShufflePlay",
      "handleLocateCurrentSong",
      "handleRefresh",
      "handleSetWyPlaylistSubscribed",
      "handleImportPlaylist",
    ],
    null,
  ],
  [
    "LocalPlaylistDetailScreen.tsx",
    "coverUrl",
    "playlist.name",
    ["playlist.songs.length"],
    [
      "handlePlayAll",
      "handleShufflePlay",
      "handleLocateCurrentSong",
      "handleOpenAdd",
      "handleDuplicatePlaylist",
      "handleExportPlaylist",
      "handleDeletePlaylist",
    ],
    null,
  ],
  [
    "BiliCollectionDetailScreen.tsx",
    "coverUrl",
    "collection.name",
    ["songs.length", "collection.trackCount", "collection.author"],
    ["handlePlayAll", "handleShufflePlay", "handleLocateCurrentSong", "handleRefresh"],
    "successfulSongs",
  ],
] as const;

const remoteDetailScreens = [
  ["ArtistDetailScreen.tsx", "artist.id", "successfulDetail", "songs", ["fetchNeteaseArtistDetail"]],
  ["AlbumDetailScreen.tsx", "album.id", "successfulDetail", "songs", ["fetchNeteaseAlbumDetail"]],
  [
    "BiliCollectionDetailScreen.tsx",
    "collection.id",
    "successfulSongs",
    "songs",
    ["getCollectionSongs", "refreshCollectionSongs"],
  ],
] as const;

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

interface ParsedSource {
  file: ts.SourceFile;
  source: string;
}

function readSource(folder: "screens" | "components", name: string) {
  return readFileSync(resolve(process.cwd(), "src", folder, name), "utf8");
}

function parseSource(folder: "screens" | "components", name: string): ParsedSource {
  const source = readSource(folder, name);
  return {
    source,
    file: ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

function parseInlineSource(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "inline-fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function visitNodes(node: ts.Node, predicate: (candidate: ts.Node) => boolean): ts.Node[] {
  const matches: ts.Node[] = [];
  const visit = (candidate: ts.Node) => {
    if (predicate(candidate)) matches.push(candidate);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return matches;
}

function getJsxTagName(node: JsxNode) {
  return ts.isJsxElement(node)
    ? node.openingElement.tagName.getText()
    : node.tagName.getText();
}

function findJsx(node: ts.Node, tagName: string): JsxNode[] {
  return visitNodes(
    node,
    (candidate) =>
      (ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate)) &&
      getJsxTagName(candidate) === tagName,
  ) as JsxNode[];
}

function getJsxAttributes(node: JsxNode) {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
}

function getJsxAttribute(node: JsxNode, name: string) {
  return getJsxAttributes(node).properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function getJsxAttributeText(file: ts.SourceFile, node: JsxNode, name: string): string {
  const attribute = getJsxAttribute(node, name);
  if (!attribute?.initializer) return "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText(file) ?? "";
  }
  return attribute.initializer.getText(file);
}

function findJsxAncestor(node: ts.Node, tagName: string): ts.JsxElement | null {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current) && getJsxTagName(current) === tagName) return current;
    current = current.parent;
  }
  return null;
}

function findIfAncestor(node: ts.Node): ts.IfStatement | null {
  let current = node.parent;
  while (current) {
    if (ts.isIfStatement(current)) return current;
    current = current.parent;
  }
  return null;
}

function findVariable(file: ts.SourceFile, name: string): ts.VariableDeclaration | null {
  return (
    visitNodes(
      file,
      (node) =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name,
    )[0] as ts.VariableDeclaration | undefined
  ) ?? null;
}

function resolveAttributeText(file: ts.SourceFile, node: JsxNode, name: string): string {
  const text = getJsxAttributeText(file, node, name);
  if (!text) return "";
  const declaration = findVariable(file, text);
  return declaration?.initializer ? `${text} ${declaration.initializer.getText(file)}` : text;
}

function getPropertyName(property: ts.ObjectLiteralElementLike): string {
  if (!property.name) return "";
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return property.name.getText();
}

function findStyleObject(file: ts.SourceFile, styleName: string): ts.ObjectLiteralExpression | null {
  const styleCalls = visitNodes(
    file,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === "StyleSheet" &&
      node.expression.name.text === "create",
  ) as ts.CallExpression[];

  for (const call of styleCalls) {
    const root = call.arguments[0];
    if (!root || !ts.isObjectLiteralExpression(root)) continue;
    const property = root.properties.find(
      (candidate) => ts.isPropertyAssignment(candidate) && getPropertyName(candidate) === styleName,
    );
    if (property && ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
      return property.initializer;
    }
  }
  return null;
}

function getStylePropertyText(
  file: ts.SourceFile,
  styleName: string,
  propertyName: string,
): string {
  const style = findStyleObject(file, styleName);
  if (!style) return "";
  const property = style.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && getPropertyName(candidate) === propertyName,
  );
  return property && ts.isPropertyAssignment(property)
    ? property.initializer.getText(file)
    : "";
}

function getJsxAttributeExpression(node: JsxNode, name: string): ts.Expression | null {
  const attribute = getJsxAttribute(node, name);
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) return null;
  return attribute.initializer.expression ?? null;
}

function resolveExpression(
  file: ts.SourceFile,
  expression: ts.Expression,
  seenIdentifiers = new Set<string>(),
): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return resolveExpression(file, expression.expression, seenIdentifiers);
  }
  if (!ts.isIdentifier(expression) || expression.text === "undefined") return expression;
  if (seenIdentifiers.has(expression.text)) return expression;

  const declaration = findVariable(file, expression.text);
  if (!declaration?.initializer) return expression;
  seenIdentifiers.add(expression.text);
  return resolveExpression(file, declaration.initializer, seenIdentifiers);
}

function isEmptyHeroValue(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined") ||
    (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0)
  );
}

function containsIdentifier(node: ts.Node, identifier: string): boolean {
  return visitNodes(
    node,
    (candidate) => ts.isIdentifier(candidate) && candidate.text === identifier,
  ).length > 0;
}

function auditRootNavigation(file: ts.SourceFile): string[] {
  const issues: string[] = [];
  const backIcons = new Set([
    "ArrowBigLeft",
    "ArrowLeft",
    "ArrowLeftCircle",
    "ChevronLeft",
    "CircleArrowLeft",
    "CornerUpLeft",
    "MoveLeft",
    "Reply",
    "ReplyAll",
    "Undo2",
  ]);

  const jsxNodes = visitNodes(
    file,
    (candidate) => ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate),
  ) as JsxNode[];
  for (const node of jsxNodes) {
    if (findJsxAncestor(node, "Modal")) continue;
    const tagName = getJsxTagName(node);
    const onPress = getJsxAttributeExpression(node, "onPress");
    const label = getJsxAttributeText(file, node, "accessibilityLabel");
    const style = getJsxAttributeText(file, node, "style");

    if (onPress && containsIdentifier(onPress, "onBack")) issues.push("onBack-handler");
    if (backIcons.has(tagName)) issues.push("back-icon");
    if (/(返回|后退|上一页|回到)|\b(?:go\s+back|back|previous)\b/iu.test(label)) {
      issues.push("back-label");
    }
    if (style.includes("styles.backButton")) issues.push("private-back-control");
  }
  return issues;
}

interface DetailHeroCallSiteExpectation {
  image: string;
  title: string;
  metadata: readonly string[];
  actions: readonly string[];
  successGuard: string | null;
}

function auditDetailHeroCallSite(
  file: ts.SourceFile,
  expectation: DetailHeroCallSiteExpectation,
): string[] {
  const issues: string[] = [];
  const heroes = findJsx(file, "DetailHero");
  if (heroes.length !== 1) return ["hero-count"];
  const hero = heroes[0];
  if (!getJsxAttributeText(file, hero, "imageUrl").includes(expectation.image)) {
    issues.push("image-binding");
  }
  if (!getJsxAttributeText(file, hero, "title").includes(expectation.title)) {
    issues.push("title-binding");
  }

  const metadataExpression = getJsxAttributeExpression(hero, "metadata");
  if (!metadataExpression) {
    issues.push("metadata-missing");
  } else {
    const resolvedMetadata = resolveExpression(file, metadataExpression);
    const metadataText = resolvedMetadata.getText(file);
    if (isEmptyHeroValue(resolvedMetadata)) issues.push("metadata-empty");
    if (expectation.metadata.some((field) => !metadataText.includes(field))) {
      issues.push("metadata-binding");
    }
    if (expectation.successGuard && !metadataText.includes(expectation.successGuard)) {
      issues.push("metadata-success-guard");
    }
  }

  const actionsExpression = getJsxAttributeExpression(hero, "actions");
  if (!actionsExpression) {
    issues.push("actions-missing");
  } else {
    const resolvedActions = resolveExpression(file, actionsExpression);
    const actionsText = resolvedActions.getText(file);
    if (isEmptyHeroValue(resolvedActions)) issues.push("actions-empty");
    if (expectation.actions.some((handler) => !actionsText.includes(handler))) {
      issues.push("actions-binding");
    }
    if (expectation.successGuard && !actionsText.includes(expectation.successGuard)) {
      issues.push("actions-success-guard");
    }
  }
  return issues;
}

describe("main screen scaffold integration", () => {
  it.each(screens)("migrates %s to the shared scaffold", (name) => {
    const source = readSource("screens", name);
    expect(source).toMatch(/import \{[^}]*ScreenScaffold[^}]*\} from "@\/components\/ScreenScaffold";/s);
    expect(source).toMatch(/return \(\s*<ScreenScaffold(?:\s|>)[\s\S]*?<ScreenScrollView(?:\s|>)/);
    expect(source.match(/<ScreenScrollView(?:\s|>)/g)).toHaveLength(1);
    expect(source).not.toMatch(/paddingBottom:\s*(100|120)/);
    expect(source).not.toMatch(/contentContainerStyle=\{\[styles\.container,\s*\{\s*backgroundColor/);

    for (const state of expectedSharedStates[name]) {
      expect(source, `${name} should render ${state}`).toMatch(new RegExp(`<${state}(?:\\s|>)`));
    }
  });

  it.each(verticalScrollCompositions)(
    "%s keeps one vertical owner across its composed row containers",
    (screen, components) => {
      const source = readSource("screens", screen);
      for (const component of components) {
        expect(source, `${screen} should compose ${component}`).toContain(component);
      }
    },
  );

  it.each(composedRowContainers)("renders %s without a nested VirtualizedList root", (name) => {
    const source = readSource("components", name);
    expect(source).not.toMatch(/\b(?:FlatList|VirtualizedList|SectionList)\b/);
  });

  it.each(detailScreens)("places one page scroll owner inside the scaffold for %s", (name) => {
    const { file } = parseSource("screens", name);
    const scaffolds = findJsx(file, "ScreenScaffold");
    const pageOwners = findJsx(file, "ScreenScrollView");
    const legacyArrows = visitNodes(
      file,
      (node) => ts.isJsxText(node) && node.text.trim() === "\u2190",
    );
    const playerCompensation = visitNodes(
      file,
      (node) =>
        ts.isPropertyAssignment(node) &&
        getPropertyName(node) === "paddingBottom" &&
        ts.isNumericLiteral(node.initializer) &&
        (node.initializer.text === "100" || node.initializer.text === "120"),
    );

    expect(scaffolds.length, `${name} should render ScreenScaffold`).toBeGreaterThan(0);
    expect(pageOwners, `${name} should render one page ScreenScrollView`).toHaveLength(1);
    expect(findJsxAncestor(pageOwners[0], "ScreenScaffold")).not.toBeNull();
    expect(legacyArrows).toHaveLength(0);
    expect(playerCompensation).toHaveLength(0);
  });

  it("does not count the Local Playlist modal portal ScrollView as the page owner", () => {
    const { file } = parseSource("screens", "LocalPlaylistDetailScreen.tsx");
    const portalScrollViews = findJsx(file, "ScrollView").filter(
      (node) => findJsxAncestor(node, "Modal") !== null,
    );
    expect(findJsx(file, "ScreenScrollView")).toHaveLength(1);
    expect(portalScrollViews).toHaveLength(1);
  });

  it.each(rootDetailScreens)("lets AppHeader exclusively own navigation for %s", (name) => {
    const { file } = parseSource("screens", name);
    expect(auditRootNavigation(file)).toHaveLength(0);
  });

  it("rejects wrapped onBack handlers and alternate back semantics outside portals", () => {
    const fixture = parseInlineSource(`
      const Fixture = ({ onBack }) => (
        <View>
          <Pressable accessibilityLabel="返回上一页" onPress={() => onBack()}>
            <ArrowLeft />
          </Pressable>
        </View>
      );
    `);
    expect(auditRootNavigation(fixture)).toEqual(
      expect.arrayContaining(["onBack-handler", "back-icon", "back-label"]),
    );

    const portalFixture = parseInlineSource(`
      const Fixture = ({ onBack }) => (
        <Modal>
          <Pressable accessibilityLabel="返回上一页" onPress={() => onBack()}>
            <ArrowLeft />
          </Pressable>
        </Modal>
      );
    `);
    expect(auditRootNavigation(portalFixture)).toHaveLength(0);
  });

  it.each(specialDetailScreens)(
    "%s retains one labeled, token-sized local close action",
    (name, accessibilityLabel) => {
      const { file } = parseSource("screens", name);
      const chevrons = findJsx(file, "ChevronLeft");
      expect(chevrons).toHaveLength(1);

      const pressable = findJsxAncestor(chevrons[0], "Pressable");
      expect(pressable).not.toBeNull();
      if (!pressable) return;

      expect(getJsxAttributeText(file, pressable, "accessibilityLabel")).toBe(
        accessibilityLabel,
      );
      const styleReference = getJsxAttributeText(file, pressable, "style");
      const styleName = styleReference.split(".").at(-1) ?? "";
      expect(getStylePropertyText(file, styleName, "minWidth")).toBe("touch.minTarget");
      expect(getStylePropertyText(file, styleName, "minHeight")).toBe("touch.minTarget");
    },
  );

  it.each(remoteDetailScreens)(
    "%s guards retained remote state and keeps it out of loading and error UI",
    (name, routeId, successfulName, songsName, requestNames) => {
      const { file } = parseSource("screens", name);
      const currentState = findVariable(file, "currentState");
      expect(currentState?.initializer && ts.isConditionalExpression(currentState.initializer)).toBe(true);
      if (!currentState?.initializer || !ts.isConditionalExpression(currentState.initializer)) return;

      expect(currentState.initializer.condition.getText(file)).toContain(`.id === ${routeId}`);
      expect(currentState.initializer.whenFalse.getText(file)).toContain('kind: "loading"');

      const successfulValue = findVariable(file, successfulName);
      expect(successfulValue?.initializer && ts.isConditionalExpression(successfulValue.initializer)).toBe(true);
      if (!successfulValue?.initializer || !ts.isConditionalExpression(successfulValue.initializer)) return;
      expect(successfulValue.initializer.condition.getText(file)).toContain(
        'currentState.kind === "success"',
      );
      expect(successfulValue.initializer.whenFalse.kind).toBe(ts.SyntaxKind.NullKeyword);

      const loadingTransitions = visitNodes(
        file,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "setRemoteState" &&
          node.arguments[0]?.getText(file).includes('kind: "loading"') === true,
      );
      expect(loadingTransitions).toHaveLength(1);
      const directRequestNames = name === "BiliCollectionDetailScreen.tsx"
        ? ["request"]
        : requestNames;
      const requestCalls = visitNodes(
        file,
        (node) =>
          ts.isCallExpression(node) &&
          (directRequestNames as readonly string[]).includes(node.expression.getText(file)),
      );
      expect(requestCalls).toHaveLength(directRequestNames.length);
      requestCalls.forEach((request, index) => {
        expect(loadingTransitions[index].getStart(file)).toBeLessThan(request.getStart(file));
      });

      const locatedResets = visitNodes(
        file,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "setLocatedSongIndex" &&
          node.arguments[0]?.kind === ts.SyntaxKind.NullKeyword,
      );
      expect(locatedResets.length).toBeGreaterThan(0);

      const hero = findJsx(file, "DetailHero");
      expect(hero).toHaveLength(1);
      const metadata = resolveAttributeText(file, hero[0], "metadata");
      const actions = resolveAttributeText(file, hero[0], "actions");
      expect(metadata).toContain(successfulName);
      expect(actions).toContain(successfulName);
      if (name !== "BiliCollectionDetailScreen.tsx") {
        expect(resolveAttributeText(file, hero[0], "imageUrl")).toContain(successfulName);
        expect(resolveAttributeText(file, hero[0], "title")).toContain(successfulName);
      }

      const songs = findVariable(file, songsName);
      expect(songs?.initializer?.getText(file)).toContain(successfulName);

      const pageOwner = findJsx(file, "ScreenScrollView")[0];
      const pageText = pageOwner.getText(file);
      expect(pageText).toContain('currentState.kind === "loading"');
      expect(pageText).toContain('currentState.kind === "error"');
    },
  );

  it.each(remoteDetailScreens)(
    "%s rejects obsolete request completion by sequence and current id",
    (name, routeId, _successfulName, _songsName, requestNames) => {
      const { file } = parseSource("screens", name);
      expect(findVariable(file, "requestSequenceRef")?.initializer?.getText(file)).toBe(
        "useRef(0)",
      );
      expect(findVariable(file, "currentIdRef")?.initializer?.getText(file)).toBe(
        `useRef(${routeId})`,
      );

      const currentIdAssignments = visitNodes(
        file,
        (node) =>
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.getText(file) === "currentIdRef.current" &&
          node.right.getText(file) === routeId,
      );
      expect(currentIdAssignments.length).toBeGreaterThan(0);

      expect(findVariable(file, "requestedId")?.initializer?.getText(file)).toBe(routeId);
      expect(findVariable(file, "requestSequence")?.initializer?.getText(file)).toBe(
        "++requestSequenceRef.current",
      );
      const currentRequestGuard = findVariable(file, "isCurrentRequest")?.initializer?.getText(file) ?? "";
      expect(currentRequestGuard).toContain(
        "requestSequenceRef.current === requestSequence",
      );
      expect(currentRequestGuard).toContain("currentIdRef.current === requestedId");

      const terminalCommits = visitNodes(
        file,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "setRemoteState" &&
          (node.arguments[0]?.getText(file).includes('kind: "success"') === true ||
            node.arguments[0]?.getText(file).includes('kind: "error"') === true),
      );
      expect(terminalCommits).toHaveLength(2);
      for (const commit of terminalCommits) {
        expect(findIfAncestor(commit)?.expression.getText(file)).toBe("isCurrentRequest()");
      }

      if (name === "BiliCollectionDetailScreen.tsx") {
        const runner = findVariable(file, "runCollectionRequest");
        const runnerInitializer = runner?.initializer;
        const runnerFunction =
          runnerInitializer &&
          ts.isCallExpression(runnerInitializer) &&
          runnerInitializer.expression.getText(file) === "useCallback"
            ? runnerInitializer.arguments[0]
            : runnerInitializer;
        expect(runnerFunction && ts.isArrowFunction(runnerFunction)).toBe(true);
        const runnerCalls = visitNodes(
          file,
          (node) =>
            ts.isCallExpression(node) &&
            node.expression.getText(file) === "runCollectionRequest",
        ) as ts.CallExpression[];
        const runnerArguments = runnerCalls.map((call) => call.arguments[0]?.getText(file));
        for (const requestName of requestNames) {
          expect(runnerArguments).toContain(requestName);
        }
      }
    },
  );

  it("renders the full responsive DetailHero behavior from its props", () => {
    const { file } = parseSource("components", "DetailHero.tsx");
    const cachedImages = findJsx(file, "CachedImage");
    expect(cachedImages).toHaveLength(1);

    const fallback = getJsxAttribute(cachedImages[0], "fallback");
    expect(fallback?.initializer && ts.isJsxExpression(fallback.initializer)).toBe(true);
    if (!fallback?.initializer || !ts.isJsxExpression(fallback.initializer)) return;
    expect(findJsx(fallback.initializer, "View").length).toBeGreaterThan(0);
    expect(findJsx(fallback.initializer, "Text")).toHaveLength(0);

    const imageBranch = visitNodes(
      file,
      (node) => ts.isConditionalExpression(node) && node.condition.getText(file) === "imageUrl",
    )[0] as ts.ConditionalExpression | undefined;
    expect(imageBranch).toBeDefined();
    if (!imageBranch) return;
    expect(findJsx(imageBranch.whenFalse, "View").length).toBeGreaterThan(0);
    expect(findJsx(imageBranch.whenFalse, "Text")).toHaveLength(0);

    const textNodes = findJsx(file, "Text");
    expect(textNodes.some((node) => node.getText(file).includes("{title}"))).toBe(true);
    const subtitleBranch = visitNodes(
      file,
      (node) => ts.isConditionalExpression(node) && node.condition.getText(file) === "subtitle",
    )[0] as ts.ConditionalExpression | undefined;
    expect(subtitleBranch && findJsx(subtitleBranch.whenTrue, "Text").length > 0).toBe(true);

    const metadataMap = visitNodes(
      file,
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(file) === "metadata" &&
        node.expression.name.text === "map",
    );
    expect(metadataMap).toHaveLength(1);
    const separators = visitNodes(
      file,
      (node) => ts.isJsxText(node) && node.text.trim() === "·",
    );
    expect(separators).toHaveLength(1);

    const actionsBranch = visitNodes(
      file,
      (node) => ts.isConditionalExpression(node) && node.condition.getText(file) === "actions",
    )[0] as ts.ConditionalExpression | undefined;
    expect(actionsBranch && findJsx(actionsBranch.whenTrue, "View").length > 0).toBe(true);

    expect(getStylePropertyText(file, "root", "flexWrap")).toBe('"wrap"');
    expect(getStylePropertyText(file, "metadata", "flexWrap")).toBe('"wrap"');
    expect(getStylePropertyText(file, "actions", "flexWrap")).toBe('"wrap"');
  });

  it.each(artworkDetailScreens)(
    "%s passes meaningful artwork, title, metadata, and actions into DetailHero",
    (name, expectedImage, expectedTitle, metadataFields, actionHandlers, successGuard) => {
      const { file } = parseSource("screens", name);
      expect(
        auditDetailHeroCallSite(file, {
          image: expectedImage,
          title: expectedTitle,
          metadata: metadataFields,
          actions: actionHandlers,
          successGuard,
        }),
      ).toHaveLength(0);
    },
  );

  it("rejects empty DetailHero metadata and actions even when the attributes exist", () => {
    const fixture = parseInlineSource(`
      const Fixture = ({ item }) => (
        <DetailHero
          imageUrl={item.cover}
          title={item.name}
          metadata={[]}
          actions={null}
        />
      );
    `);
    expect(
      auditDetailHeroCallSite(fixture, {
        image: "item.cover",
        title: "item.name",
        metadata: ["item.count"],
        actions: ["handlePlay"],
        successGuard: null,
      }),
    ).toEqual(expect.arrayContaining(["metadata-empty", "actions-empty"]));
  });

  it("interpolates the imported playlist name in the success alert", () => {
    const { file } = parseSource("screens", "PlaylistDetailScreen.tsx");
    const successAlert = (
      visitNodes(
        file,
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "Alert.alert" &&
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text === "导入成功",
      ) as ts.CallExpression[]
    )[0];
    expect(successAlert).toBeDefined();
    if (!successAlert) return;

    const message = successAlert.arguments[1];
    expect(message && ts.isTemplateExpression(message)).toBe(true);
    if (!message || !ts.isTemplateExpression(message)) return;
    expect(
      message.templateSpans.some(
        (span) => span.expression.getText(file) === "displayPlaylist.name",
      ),
    ).toBe(true);
  });

  it("defines the shared scaffold and state APIs", () => {
    const components = [
      [
        "ScreenScaffold.tsx",
        [
          "export function ScreenScaffold",
          "export function ScreenScrollView",
          "innerRef?: React.Ref<ScrollView>",
          "ref={innerRef}",
        ],
      ],
      ["SectionHeader.tsx", ["export function SectionHeader"]],
      ["ScreenState.tsx", ["export function LoadingState", "export function ErrorState", "export function EmptyState"]],
      [
        "DetailHero.tsx",
        [
          "export interface DetailHeroProps",
          "export function DetailHero",
          "imageUrl?: string | null",
          "metadata?: string[]",
        ],
      ],
    ] as const;

    for (const [name, exports] of components) {
      const path = resolve(process.cwd(), "src/components", name);
      expect(existsSync(path), `${name} should exist`).toBe(true);
      if (!existsSync(path)) continue;

      const source = readFileSync(path, "utf8");
      for (const expectedExport of exports) {
        expect(source).toContain(expectedExport);
      }
    }
  });

  it("keeps the shared surface transparent and free of PlayerBar compensation", () => {
    const source = readSource("components", "ScreenScaffold.tsx");
    expect(source).toContain('backgroundColor: "transparent"');
    expect(source).toContain("paddingBottom: spacing.l");
    expect(source).not.toMatch(/paddingBottom:\s*(100|120)/);
  });

  it("keeps all five search categories inside the phone viewport", () => {
    const source = readSource("screens", "SearchScreen.tsx");

    expect(source).toContain("styles.tabList");
    expect(source).toContain("flex: 1");
    expect(source).toContain("minWidth: 0");
    expect(source).not.toContain("<ScrollView\n            horizontal");
  });

  it("uses shared compact song geometry", () => {
    const source = readSource("components", "SongList.tsx");

    expect(source).toContain("minHeight: layout.songRowMinHeight");
    expect(source).toContain("width: layout.artworkSize");
    expect(source).toContain("padding: layout.songRowPadding");
  });

  it("keeps the forwarded ref separate from the incompatible native helper prop", () => {
    const source = readSource("components", "ScreenScaffold.tsx");
    expect(source).toContain("export interface ScreenScrollViewProps");
    expect(source).toContain("innerRef?: React.Ref<ScrollView>");
    expect(source).not.toContain("scrollViewRef?: React.Ref<ScrollView>");
  });

  it("separates submitted search state from editable input and import failures", () => {
    const source = readSource("screens", "SearchScreen.tsx");
    const importStart = source.indexOf("const handleImportPlaylist =");
    const importEnd = source.indexOf("const getPlaylistImportAction", importStart);
    const importHandler = source.slice(importStart, importEnd);

    expect(source).toContain('const [submittedQuery, setSubmittedQuery] = useState("");');
    expect(source).toContain("setSubmittedQuery(query);");
    expect(source).toContain("const showResults = Boolean(submittedQuery) && !loading && !error && hasResults;");
    expect(source).toContain("const showEmptyResults = Boolean(submittedQuery) && !loading && !error && !hasResults;");
    expect(source).toContain("onRetry={() => void runSearch(submittedQuery)}");
    expect(importHandler).not.toContain("setError(");
    expect(importHandler).toContain('Alert.alert("导入失败", message);');
  });

  it("shows one page-level empty search state only after a successful submitted query", () => {
    const source = readSource("screens", "SearchScreen.tsx");
    expect(source).toContain("{showEmptyResults && (");
    expect(source).toMatch(/\{showEmptyResults && \([\s\S]*?<EmptyState/);
    expect(source).toMatch(/\{showResults && \([\s\S]*?<View style=\{styles\.tabList\}/);
    expect(source).not.toContain('!loading && !error && activeTab === "all" && (');
  });

  it("drives Library playlist rendering from the narrowed content model", () => {
    const source = readSource("screens", "LibraryScreen.tsx");
    const renderStart = source.indexOf("const renderPlaylistContent =");
    const renderEnd = source.indexOf("const handleQuickAction", renderStart);
    const playlistRenderer = source.slice(renderStart, renderEnd);

    expect(playlistRenderer).toContain("model: PlaylistContentModel");
    expect(playlistRenderer).toContain("switch (model.kind)");
    expect(playlistRenderer).not.toMatch(/(?<!["'])\bplaylistLoading\b(?!["'])/);
    expect(playlistRenderer).not.toContain("isLoggedIn");
    expect(source).toContain("return renderPlaylistContent(contentModel);");
    expect(source).not.toContain('activeSection === "playlists" ? (');
  });

  it("removes the confirmed dead Personal FM primaryAction style", () => {
    const source = readSource("screens", "PersonalFmScreen.tsx");
    expect(source).not.toMatch(/^\s*primaryAction:\s*\{/m);
  });
});
