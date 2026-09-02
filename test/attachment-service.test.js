const test = require('node:test');
const assert = require('node:assert/strict');

const { AttachmentService, NO_VISION_MESSAGE, NO_IMAGE_TRANSPORT_MESSAGE } = require('../dist/yisi/application/attachment/attachmentService');
const { AttachmentExtractorRegistry } = require('../dist/yisi/infrastructure/attachment/attachmentExtractor');
const { TextExtractor } = require('../dist/yisi/infrastructure/attachment/textExtractor');
const { NotebookExtractor } = require('../dist/yisi/infrastructure/attachment/notebookExtractor');
const { DelimitedSpreadsheetExtractor } = require('../dist/yisi/infrastructure/attachment/delimitedSpreadsheetExtractor');
const { PdfExtractor } = require('../dist/yisi/infrastructure/attachment/pdfExtractor');
const { DocxExtractor } = require('../dist/yisi/infrastructure/attachment/docxExtractor');
const { PptxExtractor } = require('../dist/yisi/infrastructure/attachment/pptxExtractor');
const { SpreadsheetExtractor } = require('../dist/yisi/infrastructure/attachment/spreadsheetExtractor');
const { parseWebviewMessage, WebviewProtocolError } = require('../dist/yisi/ui/webviewProtocol');
const { ATTACHMENT_LIMITS, maxFileBytesForKind } = require('../dist/yisi/context/attachment/attachmentTypes');

const ENCODER = new TextEncoder();
const bytesOf = value => ENCODER.encode(value);
const wsUri = 'file:///workspace';

// TextEncoder has no UTF-16 support, so build BOM-prefixed UTF-16 by hand.
function utf16leBytes(text) {
  const out = [0xff, 0xfe];
  for (const char of text) {
    const code = char.charCodeAt(0);
    out.push(code & 0xff, (code >> 8) & 0xff);
  }
  return new Uint8Array(out);
}

function utf16beBytes(text) {
  const out = [0xfe, 0xff];
  for (const char of text) {
    const code = char.charCodeAt(0);
    out.push((code >> 8) & 0xff, code & 0xff);
  }
  return new Uint8Array(out);
}

function candidate(name, bytes, extra = {}) {
  return { name, relativePath: (extra.relativePath || name).replace(/\\/g, '/'), workspaceFolderUri: wsUri, bytes, ...extra };
}

function textOnlyRegistry() {
  return new AttachmentExtractorRegistry().register(new TextExtractor());
}

function visionProbe(modelSupported, transportSupported = false) {
  return { getVisionCapability: async () => ({ modelSupported, transportSupported }) };
}

function safeZip(files = {}) {
  return { loadAsync: async () => ({ files }) };
}

function contextText(outcome) {
  return outcome.context.attachment.chunks.map(chunk => chunk.text).join('\n');
}

test('attaches text/code files as ready context with the persisted reference shape', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const outcome = await service.attachOne(candidate('src/main.cpp', bytesOf('#include <cstdio>\nint main(){return 0;}\n')));
  assert.equal(outcome.view.status, 'ready');
  assert.equal(outcome.view.kind, 'code');
  assert.equal(outcome.view.message, undefined);
  assert.ok(outcome.context);
  assert.deepEqual(outcome.context.reference, { type: 'file', path: 'src/main.cpp', location: 'workspace', workspaceFolderUri: wsUri });
  assert.match(contextText(outcome), /int main\(\)/);
});

test('truncates a very large text attachment instead of failing it', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const body = 'line\n'.repeat(200_000); // > 150k extracted chars
  const outcome = await service.attachOne(candidate('log.txt', bytesOf(body)));
  assert.equal(outcome.view.status, 'warning');
  assert.match(outcome.view.message, /first portion is included/);
  assert.ok(outcome.context);
  assert.ok(contextText(outcome).length <= ATTACHMENT_LIMITS.maxExtractedChars);
});

test('rejects a binary renamed to a text extension', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const outcome = await service.attachOne(candidate('notes.txt', new Uint8Array([0x4d, 0x5a, 0x00, 0x03, 0x00, 0x00])));
  assert.equal(outcome.view.status, 'unsupported');
  assert.match(outcome.view.message, /cannot be attached as normal context/);
  assert.equal(outcome.context, undefined);
});

test('classifies Chinese, Japanese, and Emoji text as text, not binary', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  for (const [name, body] of [
    ['chinese.txt', '这是一段中文文本，用于验证 UTF-8 检测。'],
    ['japanese.txt', 'これは日本語のテキストです。'],
    ['emoji.txt', 'Hello 👋 world 🌍 — emoji only.']
  ]) {
    const outcome = await service.attachOne(candidate(name, bytesOf(body)));
    assert.equal(outcome.view.status, 'ready', `${name} should attach as text`);
    assert.ok(outcome.context, `${name} should yield context`);
    assert.match(contextText(outcome), /\S/);
  }
});

test('decodes UTF-16 LE/BE text with a BOM as text, not binary', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const le = utf16leBytes('hello utf-16 little endian');
  const leOutcome = await service.attachOne(candidate('le.txt', le));
  assert.notEqual(leOutcome.view.status, 'unsupported', 'UTF-16 LE must not be rejected as binary');
  assert.ok(leOutcome.context, 'UTF-16 LE should decode to context');
  assert.match(contextText(leOutcome), /hello utf-16 little endian/);

  const be = utf16beBytes('hello utf-16 big endian');
  const beOutcome = await service.attachOne(candidate('be.txt', be));
  assert.notEqual(beOutcome.view.status, 'unsupported', 'UTF-16 BE must not be rejected as binary');
  assert.ok(beOutcome.context, 'UTF-16 BE should decode to context');
  assert.match(contextText(beOutcome), /hello utf-16 big endian/);
});

test('rejects executable binary extensions outright', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const outcome = await service.attachOne(candidate('tool.exe', bytesOf('not really an exe')));
  assert.equal(outcome.view.status, 'unsupported');
  assert.equal(outcome.context, undefined);
});

test('reports unsupported legacy document formats clearly', async () => {
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new DocxExtractor({
    extractRawText: async () => ({ value: 'ignored' })
  })));
  const outcome = await service.attachOne(candidate('old.doc', bytesOf('legacy')));
  assert.equal(outcome.view.status, 'unsupported');
  assert.match(outcome.view.message, /\.docx documents are supported/);
});

test('flags a file over the size limit as a per-file error with its real kind', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const big = new Uint8Array(ATTACHMENT_LIMITS.maxFileBytes + 1).fill(0x61); // 'a' -> text, not binary
  const outcome = await service.attachOne(candidate('big.txt', big));
  assert.equal(outcome.view.status, 'error');
  assert.equal(outcome.view.kind, 'text');
  assert.match(outcome.view.message, /too large/);
  assert.equal(outcome.context, undefined);
});

test('assigns per-kind byte ceilings with Office/PDF at 32-64MB', () => {
  assert.equal(maxFileBytesForKind('pdf'), 64 * 1024 * 1024);
  assert.equal(maxFileBytesForKind('presentation'), 64 * 1024 * 1024);
  assert.equal(maxFileBytesForKind('document'), 32 * 1024 * 1024);
  assert.equal(maxFileBytesForKind('spreadsheet'), 32 * 1024 * 1024);
  assert.equal(maxFileBytesForKind('text'), ATTACHMENT_LIMITS.maxFileBytes);
});

test('labels an oversized PDF as PDF (not BIN) instead of a generic binary', async () => {
  const fakePdfjs = { getDocument: () => ({ promise: Promise.reject(new Error('unreachable')) }) };
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
  const big = new Uint8Array((64 * 1024 * 1024) + 1);
  const outcome = await service.attachOne(candidate('big.pdf', big));
  assert.equal(outcome.view.status, 'error');
  assert.equal(outcome.view.kind, 'pdf');
  assert.match(outcome.view.message, /too large/);
  assert.equal(outcome.context, undefined);
});

test('createFailure labels a read failure with the extension kind, not BIN', () => {
  const service = new AttachmentService(textOnlyRegistry());
  const outcome = service.createFailure(
    { name: 'huge.pdf', relativePath: 'huge.pdf', location: 'external', uri: 'file:///C:/huge.pdf' },
    'This file is too large to attach.',
    'pdf'
  );
  assert.equal(outcome.view.kind, 'pdf');
  assert.equal(outcome.view.status, 'error');
  assert.equal(outcome.view.location, 'external');
});

test('parses a CSV/TSV into row-aligned text with bounds', async () => {
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new DelimitedSpreadsheetExtractor()));
  const outcome = await service.attachOne(candidate('data.csv', bytesOf('name,score\nalice,10\nbob,7')));
  assert.equal(outcome.view.status, 'ready');
  assert.match(contextText(outcome), /Rows 1-3 of 3/);
  assert.match(contextText(outcome), /alice/);
  assert.match(contextText(outcome), /name \| score/);
});

test('reports the true total row count when a CSV exceeds the row cap', async () => {
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new DelimitedSpreadsheetExtractor()));
  const rows = [];
  for (let i = 1; i <= 2505; i += 1) rows.push(`r${i},value`);
  const outcome = await service.attachOne(candidate('big.csv', bytesOf(rows.join('\n'))));

  assert.equal(outcome.view.status, 'warning');
  assert.match(contextText(outcome), /Rows 1-2000 of 2505:/);
  assert.ok(outcome.context.attachment.truncated);
  assert.equal(outcome.context.attachment.metadata.cells, 2505);
  assert.match(outcome.view.message, /only the first 2000 were read/);
});

test('parses a Jupyter notebook keeping markdown, code, and text output', async () => {
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new NotebookExtractor()));
  const notebook = {
    cells: [
      { cell_type: 'markdown', source: ['# Title'], metadata: {} },
      {
        cell_type: 'code', execution_count: 1, metadata: {}, source: ['print(1)'],
        outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }]
      }
    ],
    metadata: {}, nbformat: 4, nbformat_minor: 5
  };
  const outcome = await service.attachOne(candidate('cells.ipynb', bytesOf(JSON.stringify(notebook))));
  assert.equal(outcome.view.status, 'ready');
  assert.match(contextText(outcome), /Markdown cell 1/);
  assert.match(contextText(outcome), /# Title/);
  assert.match(contextText(outcome), /Output:\n1/);
});

test('parses a DOCX through an injected mammoth module', async () => {
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new DocxExtractor({
    extractRawText: async () => ({ value: 'Heading\n\nBody paragraph with words.' })
  }, safeZip())));
  const outcome = await service.attachOne(candidate('memo.docx', bytesOf('PK fake')));
  assert.equal(outcome.view.status, 'ready');
  assert.match(contextText(outcome), /Body paragraph with words/);
});

test('extracts PDF text per page through an injected pdfjs module', async () => {
  const fakePdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: page => Promise.resolve({
          getTextContent: () => Promise.resolve({
            items: [{ str: page === 1 ? 'Hello from page one here.' : 'World of page two here.', hasEOL: false }]
          })
        }),
        destroy: () => Promise.resolve()
      })
    })
  };
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
  const outcome = await service.attachOne(candidate('paper.pdf', bytesOf('%PDF fake')));
  assert.equal(outcome.view.status, 'ready');
  assert.match(contextText(outcome), /Page 1:/);
  assert.match(contextText(outcome), /Hello/);
  assert.match(contextText(outcome), /Page 2:/);
});

test('reports a PDF that cannot be opened as an isolated error, not a generic failure', async () => {
  const fakePdfjs = {
    getDocument: () => ({ promise: Promise.reject(new Error('corrupt')) })
  };
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
  const outcome = await service.attachOne(candidate('broken.pdf', bytesOf('%PDF broken')));
  assert.equal(outcome.view.status, 'error');
  assert.match(outcome.view.message, /Failed to attach: This PDF appears to be invalid or corrupted/);
  assert.equal(outcome.context, undefined);
});

test('distinguishes PDF open failures by cause instead of one generic message', async () => {
  const cases = [
    { name: 'PasswordException', message: 'incorrect password', expected: /password-protected/ },
    { name: 'InvalidPDFException', message: 'bad header', expected: /invalid or corrupted/ },
    { name: 'MissingPDFException', message: 'no pdf', expected: /could not be found/ },
    { name: 'UnexpectedResponseException', message: 'bad response', expected: /could not be loaded/ },
    { name: 'UnknownErrorException', message: 'weird failure', expected: /Failed to parse this PDF/ }
  ];
  for (const item of cases) {
    const error = new Error(item.message);
    error.name = item.name;
    const fakePdfjs = { getDocument: () => ({ promise: Promise.reject(error) }) };
    const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
    const outcome = await service.attachOne(candidate('broken.pdf', bytesOf('%PDF broken')));
    assert.equal(outcome.view.status, 'error', item.name);
    assert.match(outcome.view.message, item.expected, item.name);
    assert.equal(outcome.context, undefined, item.name);
  }
});

test('marks external files read-only with an absolute path and file URI reference', async () => {
  const service = new AttachmentService(textOnlyRegistry());
  const outcome = await service.attachOne(candidate('notes.txt', bytesOf('external body'), {
    relativePath: 'C:/Users/me/notes.txt',
    location: 'external',
    uri: 'file:///C:/Users/me/notes.txt',
    workspaceFolderUri: undefined
  }));
  assert.equal(outcome.view.status, 'ready');
  assert.equal(outcome.view.location, 'external');
  assert.equal(outcome.view.workspaceFolderUri, undefined);
  assert.equal(outcome.view.uri, 'file:///C:/Users/me/notes.txt');
  assert.deepEqual(outcome.context.reference, {
    type: 'file',
    path: 'C:/Users/me/notes.txt',
    location: 'external',
    uri: 'file:///C:/Users/me/notes.txt'
  });
});

test('flags scanned PDFs honestly instead of pretending OCR worked', async () => {
  const fakePdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
        destroy: () => Promise.resolve()
      })
    })
  };
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
  const outcome = await service.attachOne(candidate('scan.pdf', bytesOf('%PDF scan')));
  assert.equal(outcome.view.status, 'warning');
  assert.match(outcome.view.message, /little or no extractable text/);
});

test('extracts an XLSX workbook through an injected read-excel-file module', async () => {
  const fakeReadXlsxFile = async () => [{ sheet: 'Data', data: [['name', 'score'], ['alice', 10]] }];
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new SpreadsheetExtractor(fakeReadXlsxFile, safeZip())));
  const outcome = await service.attachOne(candidate('table.xlsx', bytesOf('PK fake')));
  assert.equal(outcome.view.status, 'ready');
  assert.match(contextText(outcome), /\[Sheet: Data\]/);
  assert.match(contextText(outcome), /alice/);
});

test('keeps one failing attachment from clearing its siblings', async () => {
  const fakeZip = { loadAsync: async () => { throw new Error('not a zip'); } };
  const registry = new AttachmentExtractorRegistry()
    .register(new TextExtractor())
    .register(new PptxExtractor(fakeZip));
  const service = new AttachmentService(registry);
  const outcomes = await service.attachMany([
    candidate('good.txt', bytesOf('still here')),
    candidate('deck.pptx', bytesOf('PK broken'))
  ]);
  assert.equal(outcomes.length, 2);
  const good = outcomes.find(outcome => outcome.view.name === 'good.txt');
  const deck = outcomes.find(outcome => outcome.view.name === 'deck.pptx');
  assert.equal(good.view.status, 'ready');
  assert.ok(good.context);
  assert.equal(deck.view.status, 'error');
  assert.match(deck.view.message, /could not be opened as a package/);
  assert.equal(deck.context, undefined);
});

test('never turns an attachment failure into a thrown session error', async () => {
  const fakePdfjs = { getDocument: () => ({ promise: Promise.reject(new Error('boom')) }) };
  const service = new AttachmentService(new AttachmentExtractorRegistry().register(new PdfExtractor(async () => fakePdfjs)));
  const outcome = await service.attachOne(candidate('broken.pdf', bytesOf('%PDF')));
  assert.ok(outcome); // resolves to a per-file outcome instead of rejecting
  assert.equal(outcome.view.status, 'error');
});

test('gates image attachments on model vision and never fakes OCR', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);
  const withoutVision = new AttachmentService(textOnlyRegistry(), visionProbe(false));
  const outcome = await withoutVision.attachOne(candidate('photo.png', png));
  assert.equal(outcome.view.status, 'warning');
  assert.equal(outcome.view.message, NO_VISION_MESSAGE);
  assert.equal(outcome.context, undefined);

  const withVision = new AttachmentService(textOnlyRegistry(), visionProbe(true));
  const capableOutcome = await withVision.attachOne(candidate('photo.png', png));
  assert.equal(capableOutcome.view.status, 'warning');
  assert.equal(capableOutcome.view.message, NO_IMAGE_TRANSPORT_MESSAGE);
  assert.equal(capableOutcome.context, undefined);
});

test('accepts and rejects removeAttachment protocol messages', () => {
  assert.deepEqual(
    parseWebviewMessage({ type: 'removeAttachment', attachmentId: 'attachment-1' }),
    { type: 'removeAttachment', attachmentId: 'attachment-1' }
  );
  for (const value of [
    { type: 'removeAttachment' },
    { type: 'removeAttachment', attachmentId: '' },
    { type: 'removeAttachment', attachmentId: 'a', extra: true },
    { type: 'removeAttachment', id: 'a' }
  ]) {
    assert.throws(() => parseWebviewMessage(value), WebviewProtocolError);
  }
});
