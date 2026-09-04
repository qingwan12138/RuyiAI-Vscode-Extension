const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const {
  encodePng,
  downscaleRaster,
  inspectPng
} = require('../dist/yisi/infrastructure/attachment/pdfImageEncoding');
const { PdfExtractor } = require('../dist/yisi/infrastructure/attachment/pdfExtractor');
const { AttachmentExtractorRegistry } = require('../dist/yisi/infrastructure/attachment/attachmentExtractor');
const { AttachmentService, NO_VISION_MESSAGE } = require('../dist/yisi/application/attachment/attachmentService');

const PNG_MAGIC = 'iVBORw0KGgo'; // base64 of the PNG signature

test('encodes a valid PNG with correct dimensions, color type and payload', () => {
  // 2x2 RGB raster.
  const data = new Uint8Array([
    255, 0, 0, 0, 255, 0,
    0, 0, 255, 255, 255, 255
  ]);
  const png = encodePng({ data, width: 2, height: 2, channels: 3 });
  const info = inspectPng(png);
  assert.equal(info.width, 2);
  assert.equal(info.height, 2);
  assert.equal(info.colorType, 2);
  assert.ok(info.dataBytes > 0);

  // Gray8 and RGBA color types.
  const gray = encodePng({ data: new Uint8Array([10, 20]), width: 2, height: 1, channels: 1 });
  assert.equal(inspectPng(gray).colorType, 0);
  const rgba = encodePng({ data: new Uint8Array(2 * 1 * 4), width: 2, height: 1, channels: 4 });
  assert.equal(inspectPng(rgba).colorType, 6);
});

test('downscaleRaster shrinks to the pixel budget while keeping aspect ratio', () => {
  const width = 1240;
  const height = 1753;
  const data = new Uint8Array(width * height * 3);
  const scaled = downscaleRaster({ data, width, height, channels: 3 }, 1_000_000);
  assert.ok(scaled.width * scaled.height <= 1_000_000);
  assert.equal(scaled.channels, 3);
  // Aspect preserved (approx): width/height close to original ratio.
  const ratioBefore = width / height;
  const ratioAfter = scaled.width / scaled.height;
  assert.ok(Math.abs(ratioBefore - ratioAfter) < 0.01);
});

test('pdf extractor collects page images as PNG payloads when asked', async () => {
  const imageObject = {
    width: 2,
    height: 1,
    kind: 2, // RGB
    data: new Uint8Array([200, 30, 30, 30, 200, 30])
  };
  const page = {
    async getTextContent() { return { items: [] }; },
    async getOperatorList() { return { fnArray: [], argsArray: [['imgPage1'], ['imgPage1']] }; },
    objs: { has: () => true, get: () => imageObject },
    commonObjs: { has: () => false, get: () => undefined }
  };
  const document = { numPages: 1, getPage: async () => page, destroy: async () => undefined };
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve(document) }) };
  const extractor = new PdfExtractor(async () => pdfjs);
  const input = {
    name: 'scan.pdf',
    relativePath: 'scan.pdf',
    extension: 'pdf',
    sizeBytes: 100,
    bytes: new Uint8Array([0]),
    head: new Uint8Array(0),
    kind: 'pdf'
  };

  const withoutVision = await extractor.extract(input, { maxChars: 1000 });
  assert.equal(withoutVision.images, undefined, 'no images unless requested');

  const withVision = await extractor.extract(input, { maxChars: 1000, imagesForVision: true });
  assert.ok(withVision.images && withVision.images.length === 1);
  assert.equal(withVision.images[0].mimeType, 'image/png');
  assert.equal(withVision.images[0].fileName, 'scan-p1.png');
  assert.ok(withVision.images[0].dataBase64.startsWith(PNG_MAGIC));
});

function registryWithPdfExtractor(imagesResult) {
  const seen = { imagesForVision: undefined };
  const registry = new AttachmentExtractorRegistry();
  registry.register({
    id: 'pdf-fake',
    canHandle: input => input.kind === 'pdf',
    async extract(_input, options) {
      seen.imagesForVision = options.imagesForVision === true;
      return {
        kind: 'pdf',
        text: '',
        chunks: [],
        warnings: ['This PDF contains little or no extractable text.', 'Scanned PDF OCR is not supported yet.'],
        images: imagesResult
      };
    }
  });
  return { registry, seen };
}

const pdfCandidate = {
  name: 'scan.pdf',
  relativePath: 'scan.pdf',
  bytes: new Uint8Array(64)
};

test('pdf vision page limit honors the option (0 = whole document)', async () => {
  function makePdfJs(pages) {
    return { getDocument: () => ({ promise: Promise.resolve({
      numPages: pages.length,
      getPage: async n => pages[n - 1],
      destroy: async () => undefined
    }) }) };
  }
  function makePage(data) {
    return {
      async getTextContent() { return { items: [] }; },
      async getOperatorList() { return { fnArray: [], argsArray: [['img']] }; },
      objs: { has: () => true, get: () => data },
      commonObjs: { has: () => false, get: () => undefined }
    };
  }
  const raster = (red) => ({ width: 1, height: 1, kind: 2, data: new Uint8Array([red, 0, 0]) });
  const twoPages = makePdfJs([makePage(raster(10)), makePage(raster(200))]);
  const extractor = new PdfExtractor(async () => twoPages);
  const input = {
    name: 'all.pdf', relativePath: 'all.pdf', extension: 'pdf',
    sizeBytes: 1, bytes: new Uint8Array(1), head: new Uint8Array(1), kind: 'pdf'
  };

  const allPages = await extractor.extract(input, { maxChars: 1000, imagesForVision: true });
  assert.equal((allPages.images || []).length, 2, '0/absent option means the whole document');

  const capped = await extractor.extract(input, { maxChars: 1000, imagesForVision: true, pdfVisionPages: 1 });
  assert.equal((capped.images || []).length, 1);
  assert.equal(capped.images[0].fileName, 'all-p1.png');
});

test('attachment service delivers scanned PDF pages as images when vision is available', async () => {
  const payload = { mimeType: 'image/png', dataBase64: `${PNG_MAGIC}xx`, fileName: 'scan-p1.png' };
  const { registry, seen } = registryWithPdfExtractor([payload]);
  const service = new AttachmentService(
    registry,
    { getVisionCapability: async () => ({ modelSupported: true, transportSupported: true }) }
  );
  const outcome = await service.attachOne(pdfCandidate);
  assert.equal(seen.imagesForVision, true);
  assert.equal(outcome.view.status, 'warning');
  assert.ok(outcome.context);
  assert.deepEqual(outcome.context.attachment.images, [payload]);
  assert.equal(outcome.context.attachment.image.fileName, 'scan-p1.png');
  assert.ok(outcome.context.attachment.warnings.some(w => /attached as images for the vision model/i.test(w)));
  assert.ok(!outcome.context.attachment.warnings.some(w => /OCR is not supported/i.test(w)));
});

test('attachment service drops PDF page images and explains when the model has no vision', async () => {
  const { registry, seen } = registryWithPdfExtractor([{ mimeType: 'image/png', dataBase64: `${PNG_MAGIC}yy`, fileName: 'scan-p1.png' }]);
  const service = new AttachmentService(
    registry,
    { getVisionCapability: async () => ({ modelSupported: false, transportSupported: false }) }
  );
  const outcome = await service.attachOne(pdfCandidate);
  assert.equal(seen.imagesForVision, false);
  assert.equal(outcome.view.status, 'warning');
  assert.ok(outcome.context);
  assert.equal(outcome.context.attachment.images, undefined);
  assert.ok(outcome.context.attachment.warnings.some(w => /current model or provider cannot receive image input/i.test(w)));
});
