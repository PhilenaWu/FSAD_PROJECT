// Unit tests for cv — cvDetectionModel, retryQueueModel, and
// cvController.detect()/batchScan() (only batchScan has its own HTTP route;
// detect() is exercised directly here).
'use strict';

const mockQuery = jest.fn();

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

// --- Mock: Socket.IO emit seam (no server in tests) — same convention as
// inspections.integration.test.js's status_update assertions.
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

const cvDetectionModel = require('../../src/models/cvDetectionModel');
const retryQueueModel = require('../../src/models/retryQueueModel');
const roboflowService = require('../../src/services/roboflowService');
const socketService = require('../../src/services/socketService');
const cvController = require('../../src/controllers/cvController');
const { priorityFromScore } = require('../../src/utils/priorityFromScore');

beforeEach(() => {
  mockQuery.mockReset();
  socketService.emitToRooms.mockClear();
});

describe('cvDetectionModel.create', () => {
  test('inserts a detection with the bounding box JSON-stringified for jsonb', async () => {
    const row = {
      id: 'cv-1',
      image_url: 'https://example.com/photo.jpg',
      defect_class: 'scratch',
      confidence: '0.8047',
      bounding_box: { x: 860, y: 329.5, width: 164, height: 67 },
      source: 'resident_upload',
      status: 'processed',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await cvDetectionModel.create({
      image_url: row.image_url,
      defect_class: row.defect_class,
      confidence: 0.8047,
      bounding_box: row.bounding_box,
      source: row.source,
      status: row.status,
    });

    expect(result).toEqual(row);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO cv_detections/i);
    expect(params).toEqual([
      row.image_url,
      row.defect_class,
      0.8047,
      JSON.stringify(row.bounding_box),
      row.source,
      row.status,
      undefined, // location_block — not supplied in this call
      undefined, // location_unit
    ]);
  });

  test('stores location_block/location_unit when supplied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cv-4' }] });

    await cvDetectionModel.create({
      image_url: 'https://example.com/photo.jpg',
      defect_class: 'spill',
      confidence: 0.5,
      bounding_box: null,
      source: 'resident_upload',
      status: 'low_confidence',
      location_block: '44A',
      location_unit: '12-05',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[6]).toBe('44A');
    expect(params[7]).toBe('12-05');
  });

  test('passes a null bounding_box through as null, not the string "null"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cv-2' }] });

    await cvDetectionModel.create({
      image_url: 'https://example.com/photo.jpg',
      defect_class: null,
      confidence: 0,
      bounding_box: null,
      source: 'resident_upload',
      status: 'low_confidence',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
  });

  test('defaults status to pending when not provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cv-3', status: 'pending' }] });

    await cvDetectionModel.create({
      image_url: 'https://example.com/photo.jpg',
      defect_class: 'crack',
      confidence: 0.9,
      bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      source: 'scheduled_scan',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(\$6, 'pending'\)/);
    expect(params[5]).toBeUndefined();
  });
});

describe('cvDetectionModel.findById', () => {
  test('returns the row for a matching id', async () => {
    const row = { id: 'cv-1', defect_class: 'scratch' };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await cvDetectionModel.findById('cv-1');

    expect(result).toEqual(row);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM cv_detections WHERE id = $1',
      ['cv-1']
    );
  });

  test('returns undefined when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await cvDetectionModel.findById('missing');

    expect(result).toBeUndefined();
  });
});

describe('cvDetectionModel.updateStatus', () => {
  test('updates the row and returns it', async () => {
    const row = { id: 'cv-1', status: 'dismissed' };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await cvDetectionModel.updateStatus('cv-1', 'dismissed');

    expect(result).toEqual(row);
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE cv_detections SET status = $2 WHERE id = $1 RETURNING *',
      ['cv-1', 'dismissed']
    );
  });
});

describe('cvDetectionModel.findByStatus', () => {
  test('returns rows for the given status, newest first', async () => {
    const rows = [{ id: 'cv-2' }, { id: 'cv-1' }];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await cvDetectionModel.findByStatus('low_confidence');

    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM cv_detections WHERE status = $1 ORDER BY detected_at DESC',
      ['low_confidence']
    );
  });
});

describe('retryQueueModel', () => {
  test('create() inserts image_url and inspection_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-1', status: 'pending', attempts: 0 }] });

    const result = await retryQueueModel.create({
      image_url: 'https://example.com/photo.jpg',
      inspection_id: 'insp-1',
    });

    expect(result).toEqual({ id: 'rq-1', status: 'pending', attempts: 0 });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO retry_queue/i),
      ['https://example.com/photo.jpg', 'insp-1']
    );
  });

  test('findPending() only selects rows whose backoff window has elapsed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-1' }, { id: 'rq-2' }] });

    const result = await retryQueueModel.findPending();

    expect(result).toHaveLength(2);
    expect(mockQuery.mock.calls[0][0]).toMatch(/retry_after <= NOW\(\)/i);
  });

  test('countPending() returns the total queue depth regardless of backoff', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 4 }] });

    const result = await retryQueueModel.countPending();

    expect(result).toBe(4);
  });

  test('reschedule() bumps attempts and pushes retry_after back', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-1', attempts: 1 }] });

    await retryQueueModel.reschedule('rq-1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/attempts = attempts \+ 1/i);
    expect(sql).toMatch(/retry_after = NOW\(\) \+ INTERVAL/i);
    expect(params).toEqual(['rq-1']);
  });

  test('markProcessed() and markFailed() update status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-1', status: 'processed' }] });
    await retryQueueModel.markProcessed('rq-1');
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET status = 'processed'/i);

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-2', status: 'failed' }] });
    await retryQueueModel.markFailed('rq-2');
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'failed'/i);
  });
});

describe('cvController.detect', () => {
  // detectDefect is called through the module object (not destructured) in
  // cvController, so monkey-patching it here overrides the real
  // implementation without needing jest.mock/network access.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('CV-T01: confidence clears the threshold — cv_detections row + a separate cv_auto_detected ticket', async () => {
    jest.spyOn(roboflowService, 'detectDefect').mockResolvedValue({
      defect_class: 'scratch',
      confidence: 0.8,
      bounding_box: { x: 1, y: 1, width: 1, height: 1 },
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cv-1', status: 'processed' }] }) // cv_detections insert
      .mockResolvedValueOnce({ rows: [{ id: 'insp-auto-1', source_type: 'cv_auto_detected' }] }); // inspections insert

    const result = await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
      location_block: '44A',
      location_unit: '12-05',
    });

    expect(result.cvDetection).toEqual({ id: 'cv-1', status: 'processed' });
    expect(result.inspection).toEqual({ id: 'insp-auto-1', source_type: 'cv_auto_detected' });

    // Exactly two domain writes, in this order, and no others. Asserted by
    // table rather than by total call count: recordDetection also raises a
    // UC-008 manager notification, whose own inserts are not this test's
    // concern and would otherwise make a raw count brittle.
    const domainWrites = mockQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO (cv_detections|inspections)\b/i.test(sql)
    );
    expect(domainWrites).toHaveLength(2);

    const [detectionSql, detectionParams] = mockQuery.mock.calls[0];
    expect(detectionSql).toMatch(/INSERT INTO cv_detections/i);
    expect(detectionParams[5]).toBe('processed'); // status param

    const [inspectionSql, inspectionParams] = mockQuery.mock.calls[1];
    expect(inspectionSql).toMatch(/INSERT INTO inspections/i);
    expect(inspectionParams).toContain('cv_auto_detected');
    expect(inspectionParams).toContain('cv-1'); // cv_detection_id links back to the detection
    expect(inspectionParams).toContain('44A');
    // Regression: category must default to 'Uncategorised', not null/undefined
    // — inspections.category is NOT NULL with no way for the DB's own DEFAULT
    // to kick in once a column is explicitly listed in the INSERT.
    expect(inspectionParams).toContain('Uncategorised');

    // CV-T01: manager alert pushed on ticket creation (same rooms/pattern as
    // inspectionController's status_update emit).
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A'],
      'cv_alert',
      expect.objectContaining({ id: 'insp-auto-1', defect_class: 'scratch', confidence: 0.8 })
    );
  });

  test('CV-T02: confidence misses the threshold — cv_detections row only, no ticket created', async () => {
    jest.spyOn(roboflowService, 'detectDefect').mockResolvedValue({
      defect_class: 'spill',
      confidence: 0.445,
      bounding_box: { x: 1, y: 1, width: 1, height: 1 },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cv-2', status: 'low_confidence' }] });

    const result = await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
      location_block: '44A',
    });

    expect(result).toEqual({ cvDetection: { id: 'cv-2', status: 'low_confidence' }, inspection: null });
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the cv_detections insert — no inspections insert
    const [, params] = mockQuery.mock.calls[0];
    expect(params[5]).toBe('low_confidence');
    expect(socketService.emitToRooms).not.toHaveBeenCalled();
  });

  test('CV-T03: Roboflow returns 429 — image queued to retry_queue, no ticket, manager not notified', async () => {
    const err = new Error('Roboflow request failed: 429 — rate limited');
    err.status = 429;
    jest.spyOn(roboflowService, 'detectDefect').mockRejectedValue(err);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rq-1', status: 'pending' }] });

    const result = await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
      location_block: '44A',
      inspection_id: 'insp-1',
    });

    expect(result).toEqual({ cvDetection: null, inspection: null, queued: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO retry_queue/i);
    expect(params).toEqual(['https://example.com/photo.jpg', 'insp-1']);
    expect(socketService.emitToRooms).not.toHaveBeenCalled();
  });

  test('a non-429 failure propagates (caller logs and continues, per inspectionController)', async () => {
    jest.spyOn(roboflowService, 'detectDefect').mockRejectedValue(new Error('boom'));

    await expect(
      cvController.detect('https://example.com/photo.jpg', 'resident_upload', { location_block: '44A' })
    ).rejects.toThrow('boom');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  describe('priority blend (a report with both a human complaint and a photo)', () => {
    test('blends the human and CV scores into the originating report’s priority, no separate ticket', async () => {
      jest.spyOn(roboflowService, 'detectDefect').mockResolvedValue({
        defect_class: 'scratch',
        confidence: 0.8, // → cvScore 80
        bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'cv-1', status: 'processed' }] }) // cv_detections insert
        // blendPriorityIntoInspection's findById — human score 40
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-1', location_block: '44A', ai_priority_score: 40, status: 'Open' }],
        })
        // updatePriority — (40 + 80) / 2 = 60 → 'High' (51-75 bucket)
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-1', location_block: '44A', priority: 'High', status: 'Open', updated_at: 't' }],
        });

      const result = await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
        location_block: '44A',
        inspection_id: 'insp-1',
      });

      expect(result.inspection).toEqual({
        id: 'insp-1', location_block: '44A', priority: 'High', status: 'Open', updated_at: 't',
      });
      expect(mockQuery).toHaveBeenCalledTimes(3);

      const [detectionSql, detectionParams] = mockQuery.mock.calls[0];
      expect(detectionSql).toMatch(/INSERT INTO cv_detections/i);
      expect(detectionParams[5]).toBe('processed'); // blended detections don't sit in the review queue

      const [updateSql, updateParams] = mockQuery.mock.calls[2];
      expect(updateSql).toMatch(/UPDATE inspections SET priority/i);
      expect(updateParams).toEqual(['insp-1', 'High', 60, 'cv-1']);

      // status_update, not cv_alert — this is a priority change on an
      // existing record, not a new ticket.
      expect(socketService.emitToRooms).toHaveBeenCalledWith(
        ['manager-room', 'block-44A'],
        'status_update',
        { id: 'insp-1', status: 'Open', priority: 'High', updated_at: 't' }
      );
    });

    test('blends even when confidence misses the 70% ticket-creation threshold', async () => {
      jest.spyOn(roboflowService, 'detectDefect').mockResolvedValue({
        defect_class: 'spill',
        confidence: 0.2, // → cvScore 20, well below CONFIDENCE_THRESHOLD
        bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'cv-2', status: 'processed' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-2', location_block: '44A', ai_priority_score: 50, status: 'Open' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-2', location_block: '44A', priority: 'Medium', status: 'Open', updated_at: 't' }],
        });

      await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
        location_block: '44A',
        inspection_id: 'insp-2',
      });

      // (50 + 20) / 2 = 35 → 'Medium' (26-50 bucket); status stays 'processed'
      // on the detection even though it's below threshold — it was handled
      // via the blend, not left for manual review.
      const [detectionSql, detectionParams] = mockQuery.mock.calls[0];
      expect(detectionSql).toMatch(/INSERT INTO cv_detections/i);
      expect(detectionParams[5]).toBe('processed');
      const updateParams = mockQuery.mock.calls[2][1];
      expect(updateParams).toEqual(['insp-2', 'Medium', 35, 'cv-2']);
    });

    test('falls back to a human score of 50 when ai_priority_score is null', async () => {
      jest.spyOn(roboflowService, 'detectDefect').mockResolvedValue({
        defect_class: 'crack',
        confidence: 1, // cvScore 100
        bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'cv-3', status: 'processed' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-3', location_block: '44A', ai_priority_score: null, status: 'Open' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'insp-3', location_block: '44A', priority: 'Critical', status: 'Open', updated_at: 't' }],
        });

      await cvController.detect('https://example.com/photo.jpg', 'resident_upload', {
        location_block: '44A',
        inspection_id: 'insp-3',
      });

      // (50 + 100) / 2 = 75 → 'High' (51-75 bucket, inclusive)
      const updateParams = mockQuery.mock.calls[2][1];
      expect(updateParams).toEqual(['insp-3', 'High', 75, 'cv-3']);
    });
  });
});

describe('priorityFromScore', () => {
  test('maps 0-100 scores to the priority label enum in even quartiles', () => {
    expect(priorityFromScore(0)).toBe('Low');
    expect(priorityFromScore(25)).toBe('Low');
    expect(priorityFromScore(26)).toBe('Medium');
    expect(priorityFromScore(50)).toBe('Medium');
    expect(priorityFromScore(51)).toBe('High');
    expect(priorityFromScore(75)).toBe('High');
    expect(priorityFromScore(76)).toBe('Critical');
    expect(priorityFromScore(100)).toBe('Critical');
  });
});

describe('cvController.batchScan', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('CV-T04: 2 pending rows both succeed — both processed, response { processed: 2 }', async () => {
    // item 1 is linked to an originating report (insp-1) → blends into that
    // report's priority (recordDetection's blend path), no new ticket. item 2
    // is unlinked (scheduled_scan) and misses the threshold → cv_detections
    // row only. (An unlinked item can't create a ticket via batchScan today —
    // location only ever comes from a linked inspection.)
    mockQuery
      // findPending()
      .mockResolvedValueOnce({
        rows: [
          { id: 'rq-1', image_url: 'https://example.com/a.jpg', inspection_id: 'insp-1' },
          { id: 'rq-2', image_url: 'https://example.com/b.jpg', inspection_id: null },
        ],
      })
      // item 1: batchScan's own findById(insp-1) for the cv_detections location
      .mockResolvedValueOnce({ rows: [{ id: 'insp-1', location_block: '44A', location_unit: '12-05' }] })
      // item 1: cv_detections insert
      .mockResolvedValueOnce({ rows: [{ id: 'cv-1', status: 'processed' }] })
      // item 1: blendPriorityIntoInspection's own findById(insp-1)
      .mockResolvedValueOnce({
        rows: [{ id: 'insp-1', location_block: '44A', ai_priority_score: 60, status: 'Open' }],
      })
      // item 1: updatePriority
      .mockResolvedValueOnce({
        rows: [{ id: 'insp-1', location_block: '44A', priority: 'High', status: 'Open', updated_at: 't' }],
      })
      // item 1: markProcessed
      .mockResolvedValueOnce({ rows: [{ id: 'rq-1', status: 'processed' }] })
      // item 2: cv_detections insert (low confidence, no lookup/ticket needed)
      .mockResolvedValueOnce({ rows: [{ id: 'cv-2', status: 'low_confidence' }] })
      // item 2: markProcessed
      .mockResolvedValueOnce({ rows: [{ id: 'rq-2', status: 'processed' }] })
      // countPending() for the response's `remaining`
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    jest
      .spyOn(roboflowService, 'detectDefect')
      .mockResolvedValueOnce({
        defect_class: 'scratch',
        confidence: 0.8,
        bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      })
      .mockResolvedValueOnce({
        defect_class: 'spill',
        confidence: 0.4,
        bounding_box: { x: 1, y: 1, width: 1, height: 1 },
      });

    const result = await cvController.batchScan();

    expect(result).toEqual({ processed: 2, failed: 0, remaining: 0 });
    // item 1 blended: priority was updated on insp-1, not a new ticket created.
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE inspections SET priority/i.test(sql));
    expect(updateCall[1][0]).toBe('insp-1');
  });

  test('a repeated 429 reschedules the row instead of marking it failed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'rq-1', image_url: 'https://example.com/a.jpg', inspection_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rq-1', attempts: 1 }] }) // reschedule()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // countPending()

    const err = new Error('rate limited again');
    err.status = 429;
    jest.spyOn(roboflowService, 'detectDefect').mockRejectedValue(err);

    const result = await cvController.batchScan();

    expect(result).toEqual({ processed: 0, failed: 0, remaining: 1 });
    expect(mockQuery.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/i);
  });

  test('a non-429 failure marks the row failed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'rq-1', image_url: 'https://example.com/a.jpg', inspection_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rq-1', status: 'failed' }] }) // markFailed()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }); // countPending()

    jest.spyOn(roboflowService, 'detectDefect').mockRejectedValue(new Error('model unavailable'));

    const result = await cvController.batchScan();

    expect(result).toEqual({ processed: 0, failed: 1, remaining: 0 });
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'failed'/i);
  });
});
