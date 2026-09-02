const test = require('node:test');
const assert = require('node:assert/strict');

const { assertZipSafe, assertZipBytesSafe } = require('../dist/yisi/infrastructure/attachment/zipSafety');
const { AttachmentExtractionError } = require('../dist/yisi/infrastructure/attachment/attachmentErrors');

function entry({ uncompressedSize = 0, compressedSize = 0 } = {}) {
  return { _data: { uncompressedSize, compressedSize }, async: async () => '' };
}

function archive(count, makeEntry = () => entry()) {
  const files = {};
  for (let i = 0; i < count; i += 1) files[`file-${i}`] = makeEntry(i);
  return { files };
}

test('rejects an archive with too many compressed entries', () => {
  assert.throws(
    () => assertZipSafe(archive(2001)),
    error => error instanceof AttachmentExtractionError && /too many compressed entries/.test(error.message)
  );
});

test('rejects an archive with a single oversized entry', () => {
  const bomb = archive(1, () => entry({ uncompressedSize: 32 * 1024 * 1024 + 1, compressedSize: 100 }));
  assert.throws(
    () => assertZipSafe(bomb),
    error => error instanceof AttachmentExtractionError && /too large to read safely/.test(error.message)
  );
});

test('rejects an archive with an unsafe compression ratio', () => {
  const bomb = archive(1, () => entry({ uncompressedSize: 20_100, compressedSize: 100 })); // 201x > 200x cap
  assert.throws(
    () => assertZipSafe(bomb),
    error => error instanceof AttachmentExtractionError && /unsafe compression ratio/.test(error.message)
  );
});

test('rejects an archive whose entries expand beyond the total budget', () => {
  // 3 entries x 32MB uncompressed = 96MB > 64MB total budget (each entry keeps a
  // sane 32x ratio so only the total-budget guard trips).
  const bomb = archive(3, () => entry({ uncompressedSize: 32 * 1024 * 1024, compressedSize: 1024 * 1024 }));
  assert.throws(
    () => assertZipSafe(bomb),
    error => error instanceof AttachmentExtractionError && /expands too large/.test(error.message)
  );
});

test('assertZipBytesSafe swallows a non-zip payload so the extractor reports its own error', async () => {
  const loader = { loadAsync: async () => { throw new Error('not a zip'); } };
  await assert.doesNotReject(() => assertZipBytesSafe(loader, new Uint8Array([1, 2, 3])));
});

test('assertZipBytesSafe throws when the loaded archive is a bomb', async () => {
  const loader = { loadAsync: async () => archive(1, () => entry({ uncompressedSize: 32 * 1024 * 1024 + 1, compressedSize: 10 })) };
  await assert.rejects(
    () => assertZipBytesSafe(loader, new Uint8Array([0x50, 0x4b])),
    error => error instanceof AttachmentExtractionError && /too large to read safely/.test(error.message)
  );
});
