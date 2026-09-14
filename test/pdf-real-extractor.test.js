// Real-dependency integration coverage for the PDF attachment path.
//
// Every other PDF test injects a hand-written fake pdfjs module, so two things
// had no coverage at all:
//   1. the production loader (dynamic ESM import of pdfjs-dist 4.x + the
//      extension-host worker preload), and
//   2. the private pdf.js object-store contract the scanned-page raster path
//      reads (getOperatorList().argsArray -> page.objs.get() -> ImageKind).
// That gap is exactly how the dependency stayed on a 3.11.174 build affected by
// CVE-2024-4367 without anything failing. These tests load the real package
// through the real registry instead of a fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDefaultAttachmentRegistry } = require('../dist/yisi/infrastructure/attachment/defaultAttachmentRegistry');

const ROOT = path.join(__dirname, '..');
const installedPdfjs = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')
);
const declaredEngines = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines;

// CVE-2024-4367 / GHSA-wgrm-67xf-hhpq (arbitrary JS execution while opening a
// malicious PDF) was fixed in pdf.js 4.2.67, which removed the eval path.
const MIN_PDFJS_FOR_CVE_FIX = [4, 2, 67];
// `engines.vscode ^1.95.0` means the extension host is Electron 32, i.e.
// Node 20.18.1 (https://releases.electronjs.org/release/v32.3.3). A dependency
// whose declared Node floor is above this cannot be loaded there, however well
// it behaves on a newer dev machine.
const EXTENSION_HOST_NODE_MAJOR = 20;

function versionParts(value) {
  return String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
}
function compareVersions(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
/** Lowest Node major accepted by an `engines.node` range such as ">=22.13.0 || >=24". */
function nodeFloorMajor(range) {
  const floors = String(range ?? '')
    .split('||')
    .map(part => part.trim())
    .filter(part => part.startsWith('>='))
    .map(part => Number.parseInt(part.slice(2).trim(), 10))
    .filter(Number.isFinite);
  return floors.length > 0 ? Math.min(...floors) : 0;
}

// ------------------------------------------------------------------ PDF builder
// A real (if minimal) PDF: one page, a text object and a 16x16 RGB image XObject,
// so both the text layer and the embedded-raster path are exercised.
const IMAGE_SIZE = 16;
function buildSamplePdf() {
  const image = Buffer.alloc(IMAGE_SIZE * IMAGE_SIZE * 3);
  for (let y = 0; y < IMAGE_SIZE; y += 1) {
    for (let x = 0; x < IMAGE_SIZE; x += 1) {
      const i = (y * IMAGE_SIZE + x) * 3;
      image[i] = (x * 16) & 0xff;
      image[i + 1] = (y * 16) & 0xff;
      image[i + 2] = 128;
    }
  }
  const content = Buffer.from(
    'q 64 0 0 64 20 20 cm /Im1 Do Q\n' +
    'BT /F1 18 Tf 20 150 Td (Hello Yisi PDF) Tj ET\n',
    'latin1'
  );

  const chunks = [];
  let position = 0;
  const offsets = [];
  const push = value => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');
    chunks.push(buffer);
    position += buffer.length;
  };
  const object = (number, body) => {
    offsets[number] = position;
    push(`${number} 0 obj\n`);
    push(body);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ' +
    '/Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  object(5, Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${IMAGE_SIZE} /Height ${IMAGE_SIZE} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`, 'latin1'),
    image,
    Buffer.from('\nendstream', 'latin1')
  ]));
  object(6, Buffer.concat([
    Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream', 'latin1')
  ]));

  const xrefStart = position;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let number = 1; number <= 6; number += 1) {
    xref += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

const samplePdf = buildSamplePdf();
const pdfInput = {
  name: 'sample.pdf',
  relativePath: 'sample.pdf',
  extension: 'pdf',
  sizeBytes: samplePdf.length,
  bytes: new Uint8Array(samplePdf),
  head: new Uint8Array(0),
  kind: 'pdf'
};

// ------------------------------------------------------- dependency guards
test('the pinned pdfjs-dist contains the CVE-2024-4367 fix', () => {
  const installed = versionParts(installedPdfjs.version);
  assert.ok(
    compareVersions(installed, MIN_PDFJS_FOR_CVE_FIX) >= 0,
    `pdfjs-dist ${installedPdfjs.version} is below 4.2.67, which is where pdf.js removed the ` +
      'eval path used by CVE-2024-4367 / GHSA-wgrm-67xf-hhpq (arbitrary JS execution when ' +
      'opening a malicious PDF). Do not downgrade this dependency.'
  );
});

test('the pinned pdfjs-dist can still run on the declared extension host (Node 20)', () => {
  const floor = nodeFloorMajor(installedPdfjs.engines && installedPdfjs.engines.node);
  assert.ok(
    floor <= EXTENSION_HOST_NODE_MAJOR,
    `pdfjs-dist ${installedPdfjs.version} declares engines.node "${installedPdfjs.engines.node}", ` +
      `i.e. Node >=${floor}, but the declared baseline engines.vscode "${declaredEngines.vscode}" ships ` +
      `Node ${EXTENSION_HOST_NODE_MAJOR}.18.1 in the extension host. Bumping to the 5.x/6.x line ` +
      'requires raising engines.vscode (and re-verifying in VS Code) first.'
  );
});

test('isEvalSupported stays disabled in the extractor (runtime half of the CVE fix)', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'yisi', 'infrastructure', 'attachment', 'pdfExtractor.ts'),
    'utf8'
  );
  assert.match(source, /isEvalSupported:\s*false/);
  assert.equal(
    /isEvalSupported:\s*true/.test(source),
    false,
    'isEvalSupported:true re-enables the CVE-2024-4367 eval path.'
  );
});

// ------------------------------------------------ real end-to-end extraction
test('the production loader extracts text from a real PDF through the real pdfjs', async () => {
  const registry = createDefaultAttachmentRegistry();
  assert.equal(registry.pick(pdfInput).id, 'pdf');

  const result = await registry.extract(pdfInput, { maxChars: 4000 });

  assert.equal(result.kind, 'pdf');
  assert.equal(result.metadata.pages, 1);
  assert.match(result.text, /Hello Yisi PDF/);
  assert.equal(
    result.warnings.some(warning => /could not be read/.test(warning)),
    false,
    `no page should fail against the pinned pdfjs build: ${result.warnings.join(' | ')}`
  );
});

test('the production loader decodes a real embedded raster into a vision PNG payload', async () => {
  const registry = createDefaultAttachmentRegistry();

  const withoutVision = await registry.extract(pdfInput, { maxChars: 4000 });
  assert.equal(withoutVision.images, undefined, 'raster work only happens when vision is requested');

  const withVision = await registry.extract(pdfInput, {
    maxChars: 4000,
    imagesForVision: true
  });

  assert.ok(Array.isArray(withVision.images) && withVision.images.length === 1);
  const payload = withVision.images[0];
  assert.equal(payload.mimeType, 'image/png');
  assert.equal(payload.fileName, 'sample-p1.png');

  // Decode the PNG header instead of trusting the encoder: this proves the
  // pdf.js object-store contract (ImageKind 2 = RGB, 3 bytes per pixel) still
  // yields the expected raster after the dependency upgrade.
  const png = Buffer.from(payload.dataBase64, 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
  assert.equal(png.readUInt32BE(16), IMAGE_SIZE);
  assert.equal(png.readUInt32BE(20), IMAGE_SIZE);
});
