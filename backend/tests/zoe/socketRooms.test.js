// Unit tests for the UC-003 per-record room guard. Room names come from the
// client, so this decides membership rather than trusting what it is handed —
// these tests are the check on that.
'use strict';

jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const db = require('../../src/config/db');
const { canJoinRecordRoom } = require('../../src/config/socket');

const OWN_ID = '7f3a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  db.query.mockReset();
});

describe('canJoinRecordRoom', () => {
  it('admits the originator of the record', async () => {
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(canJoinRecordRoom(`insp-${OWN_ID}`, 'res-1')).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [OWN_ID, 'res-1']);
  });

  it('refuses a record the user did not originate', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await expect(canJoinRecordRoom(`insp-${OWN_ID}`, 'res-2')).resolves.toBe(false);
  });

  it('refuses a malformed id without reaching the database', async () => {
    // A non-uuid would reject inside pg, in an async socket handler nothing
    // awaits — an unhandled rejection that takes the process down.
    await expect(canJoinRecordRoom('insp-not-a-uuid', 'res-1')).resolves.toBe(false);
    await expect(canJoinRecordRoom("insp-' OR 1=1 --", 'res-1')).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses rooms that are not per-record rooms', async () => {
    for (const room of ['manager-room', 'admin-room', 'block-44A', 'inspector-team']) {
      await expect(canJoinRecordRoom(room, 'res-1')).resolves.toBe(false);
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses non-string room names', async () => {
    for (const room of [undefined, null, 42, { room: 'insp-1' }, ['insp-1']]) {
      await expect(canJoinRecordRoom(room, 'res-1')).resolves.toBe(false);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
});
