import { describe, expect, it } from 'vitest';

import {
  extractRecordsFromUpdate
} from '../../src/lib/server/records-extractor.js';

const personalBlock = {
  cat: 'Personal Best',
  recordClass: 'recordBoxPersonal',
  records: [{ SNATCH: '100', CLEANJERK: '125', TOTAL: '225' }]
};

describe('record display extraction', () => {
  it('separates Personal Best from ordinary record blocks', () => {
    const payload = {
      recordNames: ['World'],
      recordTable: [
        {
          cat: 'Senior 81',
          recordClass: 'recordBox',
          records: [{ SNATCH: 120, CLEANJERK: 150, TOTAL: 270, snatchHighlight: 'highlight' }]
        },
        personalBlock
      ]
    };

    const display = extractRecordsFromUpdate({ records: payload });

    expect(display.records).toHaveLength(1);
    expect(display.records[0].records['Senior 81'].S).toEqual({ value: 120, highlight: true });
    expect(display.personalRecords).toEqual({
      title: 'Personal Best',
      S: { value: '100', highlight: false },
      CJ: { value: '125', highlight: false },
      T: { value: '225', highlight: false }
    });
  });

  it('supports a PB-only payload with no record names', () => {
    const display = extractRecordsFromUpdate({
      records: { recordNames: [], recordTable: [personalBlock] }
    });

    expect(display.records).toEqual([]);
    expect(display.personalRecords?.title).toBe('Personal Best');
  });

  it('does not assign a PB block to stale ordinary record names', () => {
    const display = extractRecordsFromUpdate({
      records: { recordNames: ['World', 'National'], recordTable: [personalBlock] }
    });

    expect(display.records).toEqual([]);
    expect(display.personalRecords?.S.value).toBe('100');
  });

  it('parses string payloads', () => {
    const payload = JSON.stringify({ recordNames: [], recordTable: [personalBlock] });

    expect(extractRecordsFromUpdate({ records: payload }).personalRecords?.T.value).toBe('225');
  });
});