const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifest = fs.readFileSync(path.resolve(__dirname, "../android/app/src/main/AndroidManifest.xml"), "utf8");
const mainActivity = manifest.match(/<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>([\s\S]*?)<\/activity>/)?.[1];
assert.ok(mainActivity, "MainActivity 必须在真实清单中存在");

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/android:(\w+)="([^"]*)"/g)]
    .map(([, key, value]) => [key, value.replace(/\\\\/g, "\\")]));
}

// 解析真实清单；同一 intent-filter 中所有 data 的 scheme、MIME、authority、path 各自为并集。
const filters = [...mainActivity.matchAll(/<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter>/g)]
  .map(([, body]) => ({
    actions: [...body.matchAll(/<action\b[^>]*\/>/g)].map(([tag]) => attributes(tag).name),
    categories: [...body.matchAll(/<category\b[^>]*\/>/g)].map(([tag]) => attributes(tag).name),
    data: [...body.matchAll(/<data\b[^>]*\/>/g)].map(([tag]) => attributes(tag)),
  }));

// Android PatternMatcher 的 simple glob 使用字符重复而非文件系统 glob，且不回溯。
function matchesSimpleGlob(pattern, value) {
  let patternIndex = 0;
  let valueIndex = 0;
  let next = pattern[0];
  while (patternIndex < pattern.length && valueIndex < value.length) {
    let current = next;
    patternIndex += 1;
    next = pattern[patternIndex];
    const escaped = current === "\\";
    if (escaped) {
      current = next;
      patternIndex += 1;
      next = pattern[patternIndex];
    }
    if (next === "*") {
      if (!escaped && current === ".") {
        if (patternIndex >= pattern.length - 1) return true;
        patternIndex += 1;
        next = pattern[patternIndex];
        if (next === "\\") next = pattern[++patternIndex];
        while (valueIndex < value.length && value[valueIndex] !== next) valueIndex += 1;
        if (valueIndex === value.length) return false;
        patternIndex += 1;
        next = pattern[patternIndex];
        valueIndex += 1;
      } else {
        while (valueIndex < value.length && value[valueIndex] === current) valueIndex += 1;
        patternIndex += 1;
        next = pattern[patternIndex];
      }
    } else {
      if (current !== "." && value[valueIndex] !== current) return false;
      valueIndex += 1;
    }
  }
  if (patternIndex >= pattern.length && valueIndex >= value.length) return true;
  return patternIndex === pattern.length - 2 && pattern[patternIndex] === "." && pattern[patternIndex + 1] === "*";
}

function matchesMime(expected, actual) {
  if (!actual) return false;
  if (expected === "*/*") return true;
  if (expected.endsWith("/*")) return actual.startsWith(expected.slice(0, -1));
  return expected === actual;
}

function matchesView(uri, mimeType, apiLevel = 31, categories = ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"]) {
  const url = new URL(uri);
  return filters.some(filter => {
    if (!filter.actions.includes("android.intent.action.VIEW")) return false;
    if (!categories.every(category => filter.categories.includes(category))) return false;
    const schemes = filter.data.flatMap(data => data.scheme ? [data.scheme] : []);
    if (!schemes.includes(url.protocol.slice(0, -1))) return false;
    const mimeTypes = filter.data.flatMap(data => data.mimeType ? [data.mimeType] : []);
    if (mimeTypes.length ? !mimeTypes.some(expected => matchesMime(expected, mimeType)) : mimeType != null) return false;
    const hosts = filter.data.flatMap(data => data.host ? [data.host] : []);
    if (hosts.length && !hosts.some(host => host === "*" || host === url.hostname)) return false;
    const patterns = filter.data.flatMap(data => data.pathPattern ? [data.pathPattern] : []);
    const suffixes = apiLevel >= 31 ? filter.data.flatMap(data => data.pathSuffix ? [data.pathSuffix] : []) : [];
    const pathname = decodeURIComponent(url.pathname);
    return patterns.length + suffixes.length === 0
      || patterns.some(pattern => matchesSimpleGlob(pattern, pathname))
      || suffixes.some(suffix => pathname.endsWith(suffix));
  });
}

for (const mime of [
  "audio/mpeg", "audio/mp4", "audio/flac", "audio/x-wav", "audio/aac", "audio/ogg", "audio/opus", "audio/amr",
  "application/ogg", "application/javascript", "text/javascript", "application/x-javascript", "application/json",
  "text/plain", "application/octet-stream",
]) {
  test(`不透明本地 content URI 使用 ${mime} 时提供 Auralflow 打开方式`, () => {
    assert.equal(matchesView("content://downloads/document/418", mime), true);
  });
}

for (const extension of ["mp3", "m4a", "m4b", "flac", "wav", "aac", "ogg", "opus", "amr", "js", "json"]) {
  for (const suffix of [extension, extension.toUpperCase()]) {
    test(`本地 .${suffix} 在无 MIME 或错误 MIME 时仍可打开`, () => {
      for (const scheme of ["file", "content"]) {
        const uri = scheme === "file" ? `file:///storage/emulated/0/Download/song.${suffix}` : `content://files/Download/song.${suffix}`;
        assert.equal(matchesView(uri, undefined), true, `${scheme} 无 MIME`);
        assert.equal(matchesView(uri, "application/x-mislabeled-download"), true, `${scheme} 错误 MIME`);
      }
    });
  }
}

for (const suffix of ["js", "JS", "json", "JSON", "mp3", "MP3"]) {
  for (const [label, filePath] of [
    ["多点文件名", `/Download/my.source.v1.${suffix}`],
    ["带点目录", `/Download/export.v1/song.${suffix}`],
  ]) {
    for (const [mimeLabel, mime] of [["无 MIME", undefined], ["错误 MIME", "application/x-mislabeled-download"]]) {
      test(`API 31 的${label} .${suffix} 在${mimeLabel}时仍可关联`, () => {
        assert.equal(matchesView(`file://${filePath}`, mime), true);
        assert.equal(matchesView(`content://files${filePath}`, mime), true);
      });
    }
  }
}

for (const apiLevel of [24, 30]) {
  test(`API ${apiLevel} 保留单点后缀关联且不扩大到无 MIME 的 PDF/ZIP`, () => {
    for (const scheme of ["file", "content"]) {
      const prefix = scheme === "file" ? "file://" : "content://files";
      for (const suffix of ["js", "JS", "json", "JSON", "mp3", "MP3"]) {
        assert.equal(matchesView(`${prefix}/Download/song.${suffix}`, undefined, apiLevel), true);
        assert.equal(matchesView(`${prefix}/Download/song.${suffix}`, "application/x-mislabeled-download", apiLevel), true);
      }
      for (const suffix of ["pdf", "PDF", "zip", "ZIP"]) {
        assert.equal(matchesView(`${prefix}/Download/document.${suffix}`, undefined, apiLevel), false);
      }
    }
  });

  test(`API ${apiLevel} 多点路径通过正确或通用 MIME 关联`, () => {
    for (const prefix of ["file://", "content://files"]) {
      for (const [suffix, mime] of [["js", "application/javascript"], ["JS", "text/javascript"], ["json", "application/json"], ["mp3", "audio/mpeg"], ["MP3", "audio/mpeg"]]) {
        for (const filePath of [`/Download/source.v1.${suffix}`, `/Download/export.v1/song.${suffix}`]) {
          for (const type of [mime, "text/plain", "application/octet-stream"]) {
            assert.equal(matchesView(`${prefix}${filePath}`, type, apiLevel), true);
          }
        }
      }
    }
  });

  test(`API ${apiLevel} 明确保留多点且无 MIME/误标 MIME 的系统匹配边界`, () => {
    for (const prefix of ["file://", "content://files"]) {
      for (const filePath of ["/Download/my.source.v1.js", "/Download/export.v1/song.MP3"]) {
        assert.equal(matchesView(`${prefix}${filePath}`, undefined, apiLevel), false);
        assert.equal(matchesView(`${prefix}${filePath}`, "application/x-mislabeled-download", apiLevel), false);
      }
    }
  });
}

test("simple glob 去掉扩展名前的点仍会停在第一个同名字母，且会接受无点文件名", () => {
  assert.equal(matchesSimpleGlob(".*js", "/Download/my.source.v1.js"), true);
  assert.equal(matchesSimpleGlob(".*js", "/Download/js-cache/my.source.v1.js"), false);
  assert.equal(matchesSimpleGlob(".*mp3", "/storage/emulated/0/song.mp3"), false);
  assert.equal(matchesSimpleGlob(".*js", "/Download/notesjs"), true);
});

test("HTTP、HTTPS 和非本地协议不接收文件打开请求", () => {
  for (const scheme of ["http", "https", "ftp"]) {
    for (const mime of ["audio/mpeg", "application/javascript", "text/plain", "application/octet-stream", undefined]) {
      assert.equal(matchesView(`${scheme}://example.test/song.mp3`, mime), false);
      assert.equal(matchesView(`${scheme}://example.test/source.js`, mime), false);
    }
  }
});

test("不透明 URI 的明确图片/PDF 类型及无 MIME 不属于文件关联", () => {
  for (const mime of ["image/png", "image/jpeg", "application/pdf", undefined]) {
    assert.equal(matchesView("content://downloads/document/418", mime), false);
  }
});

test("未知扩展的明确类型不命中后缀规则，通用类型留给运行时读取 DISPLAY_NAME", () => {
  assert.equal(matchesView("content://files/Download/readme.pdf", "application/pdf"), false);
  assert.equal(matchesView("file:///Download/archive.zip", undefined), false);
  assert.equal(matchesView("content://downloads/document/418", "application/octet-stream"), true);
  assert.equal(matchesView("content://downloads/document/418", "text/plain"), true);
});

test("MIME 通配必须受本地 scheme 和后缀限制，所有文件打开入口保留 DEFAULT/BROWSABLE", () => {
  const localFilters = filters.filter(filter => filter.data.some(data => ["file", "content"].includes(data.scheme)));
  assert.ok(localFilters.length > 0);
  for (const filter of localFilters) {
    assert.ok(filter.actions.includes("android.intent.action.VIEW"));
    assert.ok(filter.categories.includes("android.intent.category.DEFAULT"));
    assert.ok(filter.categories.includes("android.intent.category.BROWSABLE"));
    assert.ok(filter.data.filter(data => data.scheme).every(data => ["file", "content"].includes(data.scheme)));
    if (filter.data.some(data => data.mimeType === "*/*")) {
      assert.ok(filter.data.some(data => data.pathPattern), "不允许无条件 */* 文件关联");
      assert.ok(filter.data.some(data => data.host), "Android 路径匹配必须有 authority");
    }
  }
  assert.ok(filters.every(filter => !filter.actions.includes("android.intent.action.SEND")));
});
