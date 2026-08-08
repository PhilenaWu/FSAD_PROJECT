// Tests for the client-side CSV export (utils/csvDownload.js, phase task 5.10)
// — the "Export CSV" button behind the analytics and cost dashboards. The
// escaping rules and the BOM are the parts that quietly corrupt a file rather
// than fail loudly, so they are what these assert.
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { BOM, downloadCsv } from '../../../frontend/src/utils/csvDownload';

// jsdom implements neither createObjectURL nor anchor navigation, so both are
// stubbed. The stub also captures the Blob, which is the only way to read back
// what the function actually wrote.
let blobs;
let clicks;
let revoked;

beforeEach(() => {
  blobs = [];
  clicks = [];
  revoked = [];

  URL.createObjectURL = vi.fn((blob) => {
    blobs.push(blob);
    return `blob:mock-${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    clicks.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The text handed to the Blob, BOM included, as one string. Read through
// TextDecoder with ignoreBOM rather than Blob.text(): text() is specified to
// run "UTF-8 decode", which strips a leading BOM — so the very byte these
// tests exist to check would be invisible.
const written = async () => {
  const buffer = await blobs[0].arrayBuffer();
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buffer);
};

describe('downloadCsv', () => {
  test('writes a header row from the first object, then one row per record', async () => {
    downloadCsv([
      { block: '44A', category: 'Doors', count: 3 },
      { block: '44B', category: 'Lighting', count: 1 },
    ]);

    const text = await written();
    expect(text.slice(BOM.length).split('\n')).toEqual([
      'block,category,count',
      '44A,Doors,3',
      '44B,Lighting,1',
    ]);
  });

  test('opens with a UTF-8 BOM so Excel does not mangle the export', async () => {
    // Without it, an em dash or an accented contractor name reaches the user as
    // mojibake — the file opens fine, it is just wrong.
    downloadCsv([{ contractor: 'Kone — Sengkang' }]);

    const text = await written();
    expect(text.startsWith(BOM)).toBe(true);
    expect(text).toContain('Kone — Sengkang');
  });

  test('quotes and escapes the values that would otherwise break the row', async () => {
    downloadCsv([
      {
        remark: 'Door gap, panel B',        // comma would split the cell
        quote: 'He said "stuck"',           // quotes must be doubled
        note: 'line one\nline two',         // newline would split the row
      },
    ]);

    const text = await written();
    const body = text.slice(BOM.length).split('\n').slice(1).join('\n');
    expect(body).toBe('"Door gap, panel B","He said ""stuck""","line one\nline two"');
  });

  test('a null or missing value becomes an empty cell, not "null"', async () => {
    // actual_cost is nullable and lift is null for estate defects; both reach
    // the export as blanks rather than the string "null".
    downloadCsv([{ lift: null, cost: undefined, block: '44A' }]);

    const text = await written();
    expect(text.slice(BOM.length).split('\n')[1]).toBe(',,44A');
  });

  test('names the file and releases the object URL', async () => {
    downloadCsv([{ block: '44A' }], 'cost-jobs.csv');

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('cost-jobs.csv');
    expect(revoked).toEqual([clicks[0].href]);
  });

  test('an empty result set downloads nothing at all', () => {
    // A filter that matches no rows must not hand the user a file containing
    // only a BOM — there are no headers to write without a first row.
    downloadCsv([]);

    expect(clicks).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
