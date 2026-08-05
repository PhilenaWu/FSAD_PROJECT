// Unit tests for the UC-014 spot-check defect email body (D.2). Nodemailer is
// mocked at the transport seam, so these assert what gets composed — the D.2
// subject, the defect table, the 2-week note and the deep link — without sending.
// The delivery wiring (D.3) is covered in inspections.integration.test.js.
'use strict';

process.env.FRONTEND_URL = 'https://em-services.test';

// `mock`-prefixed so jest's module-factory hoisting allows the reference.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const { sendDefectAlert } = require('../../src/services/emailService');

const RECORD = {
  title: 'Lift inspection — 44A-L1',
  category: 'Uncategorised',
  priority: 'Medium',
  location_block: '44A',
  location_unit: null,
  target_deadline: '2026-08-19T00:00:00.000Z',
};

// Two failed checkpoints as findDefectsForEmail returns them.
const DEFECTS = [
  {
    section: 'B — Car Interior',
    item_no: 11,
    item_text: 'Car door closes flush without rubbing',
    severity: 'Critical',
    remark: 'Door binds on the left guide',
    photo_url: 'https://res.cloudinary.com/test/defects/door.png',
  },
  {
    section: 'C — Machine Room',
    item_no: 22,
    item_text: 'Machine room free of stored materials',
    severity: 'Minor',
    remark: null,
    photo_url: null,
  },
];

const TO = 'service@konemaint.com.sg';
const sent = () => mockSendMail.mock.calls[0][0];

beforeEach(() => {
  mockSendMail.mockClear();
});

describe('spot-check defect alert (D.2)', () => {
  test('subject names the block, lift and defect count', async () => {
    await sendDefectAlert(RECORD, TO, { defects: DEFECTS, lift_code: '44A-L1' });

    expect(sent().subject).toBe(
      '[Spot-Check Defect] Blk 44A Lift 44A-L1 — 2 defect(s), due 19 Aug 2026'
    );
  });

  test('lists every failed checkpoint with section, item number and severity', async () => {
    await sendDefectAlert(RECORD, TO, { defects: DEFECTS, lift_code: '44A-L1' });

    const { text, html } = sent();
    expect(text).toContain('Failed checkpoints (2):');
    expect(text).toContain('11. [B — Car Interior] Car door closes flush without rubbing');
    expect(text).toContain('Severity: Critical');
    expect(text).toContain('Remark: Door binds on the left guide');
    expect(text).toContain('22. [C — Machine Room] Machine room free of stored materials');
    expect(html).toContain('Car door closes flush without rubbing');
    expect(html).toContain('<th>Severity</th>');
  });

  test('photos travel as Cloudinary links, never as attachments', async () => {
    await sendDefectAlert(RECORD, TO, { defects: DEFECTS, lift_code: '44A-L1' });

    const mail = sent();
    expect(mail.text).toContain('Photo: https://res.cloudinary.com/test/defects/door.png');
    expect(mail.html).toContain('href="https://res.cloudinary.com/test/defects/door.png"');
    // HLD §10 is explicit, and a 25-photo form would bounce on size.
    expect(mail.attachments).toBeUndefined();
  });

  test('states the 2-week rule and deep-links to the contractor inbox', async () => {
    await sendDefectAlert(RECORD, TO, { defects: DEFECTS, lift_code: '44A-L1' });

    const { text, html } = sent();
    expect(text).toContain('Rectification is due within 2 weeks');
    expect(text).toContain('https://em-services.test/contractor-inbox');
    expect(html).toContain('href="https://em-services.test/contractor-inbox"');
  });

  test('a checkpoint with no remark or photo still renders', async () => {
    await sendDefectAlert(RECORD, TO, { defects: [DEFECTS[1]], lift_code: '44A-L1' });

    const { text, html } = sent();
    expect(text).toContain('Severity: Minor');
    expect(text).not.toContain('Remark: null');
    expect(html).not.toContain('null');
  });
});

describe('assignment alert without a defect list', () => {
  // A resident complaint assigned from the triage queue has no checkpoints, so
  // it must keep the generic subject rather than claim "0 defect(s)".
  test('falls back to the generic subject and omits the checkpoint table', async () => {
    await sendDefectAlert(
      { ...RECORD, title: 'Lift cabin door fault', category: 'Lift', priority: 'High' },
      TO
    );

    const mail = sent();
    expect(mail.subject).toBe('Defect Assigned — Lift cabin door fault (Block 44A)');
    expect(mail.text).toContain('A defect has been assigned to you for rectification.');
    expect(mail.text).not.toContain('Failed checkpoints');
    expect(mail.text).not.toContain('within 2 weeks');
  });
});

describe('overdue chase (D.7)', () => {
  test('past the deadline reads as overdue, with the day count', async () => {
    await sendDefectAlert(RECORD, TO, {
      email_type: 'overdue_chase',
      days_remaining: -4,
    });

    const mail = sent();
    expect(mail.subject).toBe(
      '[Overdue] Lift inspection — 44A-L1 (Block 44A) — 4 day(s) past deadline'
    );
    expect(mail.text).toContain('passed its rectification deadline 4 day(s) ago');
  });

  test('three days out reads as due soon, not overdue', async () => {
    await sendDefectAlert(RECORD, TO, {
      email_type: 'overdue_chase',
      days_remaining: 3,
    });

    const mail = sent();
    expect(mail.subject).toBe(
      '[Due Soon] Lift inspection — 44A-L1 (Block 44A) — due 19 Aug 2026'
    );
    expect(mail.text).toContain('due for rectification on 19 Aug 2026');
    expect(mail.text).not.toContain('past deadline');
  });

  test('a chase never renders the spot-check 2-week note', async () => {
    await sendDefectAlert(RECORD, TO, {
      email_type: 'overdue_chase',
      days_remaining: -1,
      defects: DEFECTS,
    });

    expect(sent().text).not.toContain('within 2 weeks');
  });
});
