const QR_VERSION = 5;
const QR_SIZE = QR_VERSION * 4 + 17;
const QR_DATA_CODEWORDS = 108;
const QR_EC_CODEWORDS = 26;
const QR_MASK_PATTERN = 0;

type QrMatrix = boolean[][];

function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function buildDataCodewords(text: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > 106) {
    throw new Error("二维码内容过长，无法生成网易云扫码二维码");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, QR_DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }

  for (let pad = 0xec; codewords.length < QR_DATA_CODEWORDS; pad ^= 0xfd) {
    codewords.push(pad);
  }
  return codewords;
}

function buildGfTables() {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let value = 1;

  for (let i = 0; i < 255; i += 1) {
    exp[i] = value;
    log[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < exp.length; i += 1) exp[i] = exp[i - 255];
  return { exp, log };
}

const GF = buildGfTables();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF.exp[GF.log[a] + GF.log[b]];
}

function buildGeneratorPolynomial(degree: number): number[] {
  let polynomial = [1];
  for (let root = 0; root < degree; root += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let i = 0; i < polynomial.length; i += 1) {
      next[i] ^= polynomial[i];
      next[i + 1] ^= gfMultiply(polynomial[i], GF.exp[root]);
    }
    polynomial = next;
  }
  return polynomial.slice(1);
}

function buildErrorCorrection(data: number[]): number[] {
  const generator = buildGeneratorPolynomial(QR_EC_CODEWORDS);
  const remainder = new Array<number>(QR_EC_CODEWORDS).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < generator.length; i += 1) {
      remainder[i] ^= gfMultiply(generator[i], factor);
    }
  }
  return remainder;
}

function makeMatrix(): QrMatrix {
  return Array.from({ length: QR_SIZE }, () => Array<boolean>(QR_SIZE).fill(false));
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < QR_SIZE && y < QR_SIZE;
}

function setFunctionModule(
  modules: QrMatrix,
  functionModules: QrMatrix,
  x: number,
  y: number,
  dark: boolean,
): void {
  if (!inBounds(x, y)) return;
  modules[y][x] = dark;
  functionModules[y][x] = true;
}

function drawFinderPattern(modules: QrMatrix, functionModules: QrMatrix, x: number, y: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      const isFinder =
        dx >= 0 &&
        dx <= 6 &&
        dy >= 0 &&
        dy <= 6 &&
        (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunctionModule(modules, functionModules, xx, yy, isFinder);
    }
  }
}

function drawAlignmentPattern(modules: QrMatrix, functionModules: QrMatrix, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(
        modules,
        functionModules,
        x + dx,
        y + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

function drawTimingPatterns(modules: QrMatrix, functionModules: QrMatrix): void {
  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunctionModule(modules, functionModules, 6, i, dark);
    setFunctionModule(modules, functionModules, i, 6, dark);
  }
}

function getFormatBits(): number {
  const data = (1 << 3) | QR_MASK_PATTERN;
  let remainder = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if (((remainder >>> i) & 1) !== 0) remainder ^= 0x537 << (i - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function drawFormatBits(modules: QrMatrix, functionModules: QrMatrix): void {
  const bits = getFormatBits();

  for (let i = 0; i <= 5; i += 1) setFunctionModule(modules, functionModules, 8, i, bit(bits, i));
  setFunctionModule(modules, functionModules, 8, 7, bit(bits, 6));
  setFunctionModule(modules, functionModules, 8, 8, bit(bits, 7));
  setFunctionModule(modules, functionModules, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) setFunctionModule(modules, functionModules, 14 - i, 8, bit(bits, i));

  for (let i = 0; i < 8; i += 1) setFunctionModule(modules, functionModules, QR_SIZE - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i += 1) setFunctionModule(modules, functionModules, 8, QR_SIZE - 15 + i, bit(bits, i));
  setFunctionModule(modules, functionModules, 8, QR_SIZE - 8, true);
}

function shouldMask(x: number, y: number): boolean {
  return (x + y) % 2 === 0;
}

function drawData(modules: QrMatrix, functionModules: QrMatrix, codewords: number[]): void {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = ((right + 1) & 2) === 0 ? QR_SIZE - 1 - vertical : vertical;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (functionModules[y][x]) continue;

        const dark =
          bitIndex < totalBits &&
          ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        modules[y][x] = shouldMask(x, y) ? !dark : dark;
        bitIndex += 1;
      }
    }
  }
}

function buildQrMatrix(text: string): QrMatrix {
  const modules = makeMatrix();
  const functionModules = makeMatrix();

  drawFinderPattern(modules, functionModules, 0, 0);
  drawFinderPattern(modules, functionModules, QR_SIZE - 7, 0);
  drawFinderPattern(modules, functionModules, 0, QR_SIZE - 7);
  drawAlignmentPattern(modules, functionModules, 30, 30);
  drawTimingPatterns(modules, functionModules);
  drawFormatBits(modules, functionModules);

  const data = buildDataCodewords(text);
  drawData(modules, functionModules, [...data, ...buildErrorCorrection(data)]);
  return modules;
}

export function createQrSvgDataUri(text: string): string {
  const modules = buildQrMatrix(text);
  const quietZone = 4;
  const viewSize = QR_SIZE + quietZone * 2;
  const rects: string[] = [];

  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) rects.push(`M${x + quietZone},${y + quietZone}h1v1h-1z`);
    });
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges">`,
    `<path fill="#fff" d="M0 0h${viewSize}v${viewSize}H0z"/>`,
    `<path fill="#111827" d="${rects.join("")}"/>`,
    "</svg>",
  ].join("");

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
