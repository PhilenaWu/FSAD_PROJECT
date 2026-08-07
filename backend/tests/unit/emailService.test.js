// Unit tests for the UC-014 defect alert email variants (D.2 / D.4). Nodemailer
// is mocked at the transport seam, so the tests assert what gets composed —
// subject, recipients, and the facts in the body — without sending anything.
'use strict';

// `mock`-prefixed so jest's module-factory hoisting allows the reference.
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const {
  sendDefectAlert,
  sendResidentApprovedEmail,
} = require('../../src/services/emailService');

const DEFECT = {
  title: 'Lift cabin door fault',
  category: 'Lift',
  priority: 'High',
  location_block: '44A',
  location_unit: '12-34',
  description: 'Cabin door on Lift 1 is stalling on close.',
  target_deadline: '2026-08-12T00:00:00.000Z',
};
const TO = 'lc@example.com';
const REASON = 'Completion photo shows the same defect — sensor still misaligned.';

// The single sendMail payload from the call under test.
const sent = () => mockSendMail.mock.calls[0][0];

beforeEach(() => {
  mockSendMail.mockClear();
});

describe('sendDefectAlert — assignment variant (D.2)', () => {
  test('defaults to the defect_alert variant and states the deadline', async () => {
    await sendDefectAlert(DEFECT, TO);

    const mail = sent();
    expect(mail.to).toBe(TO);
    expect(mail.subject).toBe('Defect Assigned — Lift cabin door fault (Block 44A, Unit 12-34)');
    expect(mail.text).toContain('A defect has been assigned to you for rectification.');
    expect(mail.text).toContain('Rectification deadline: 12 Aug 2026');
    // Nothing rejection-specific leaks into the assignment mail.
    expect(mail.text).not.toContain('Reason for rejection');
    expect(mail.html).not.toContain('Reason for rejection');
  });

  test('omits the unit from the location when there is none', async () => {
    await sendDefectAlert({ ...DEFECT, location_unit: null }, TO);
    expect(sent().subject).toBe('Defect Assigned — Lift cabin door fault (Block 44A)');
  });

  test('a missing deadline reads as "not set", not as a bad date', async () => {
    await sendDefectAlert({ ...DEFECT, target_deadline: null }, TO);
    expect(sent().text).toContain('Rectification deadline: not set');
    expect(sent().text).not.toMatch(/Invalid Date/);
  });
});

describe('sendDefectAlert — rejection variant (D.4)', () => {
  test('quotes the reason and the new deadline (UC-014 A2)', async () => {
    await sendDefectAlert(DEFECT, TO, { email_type: 'rejection', reason: REASON });

    const mail = sent();
    expect(mail.subject).toBe(
      'Rectification Rejected — Lift cabin door fault (Block 44A, Unit 12-34)'
    );
    expect(mail.text).toContain('was not accepted');
    expect(mail.text).toContain(`Reason for rejection: ${REASON}`);
    expect(mail.text).toContain('New rectification deadline: 12 Aug 2026');
    expect(mail.html).toContain(REASON);
    expect(mail.html).toContain('<strong>New deadline</strong>');
  });

  test('still carries the defect facts the contractor needs to act', async () => {
    await sendDefectAlert(DEFECT, TO, { email_type: 'rejection', reason: REASON });

    const mail = sent();
    expect(mail.text).toContain('Title: Lift cabin door fault');
    expect(mail.text).toContain('Category: Lift');
    expect(mail.text).toContain('Priority: High');
    expect(mail.text).toContain('Location: Block 44A, Unit 12-34');
  });

  test('an unrecognised email_type falls back to the assignment wording', async () => {
    await sendDefectAlert(DEFECT, TO, { email_type: 'something_else' });
    expect(sent().subject).toMatch(/^Defect Assigned/);
  });
});

describe('sendResidentApprovedEmail', () => {
  const RESIDENT = {
    email: 'nadia@example.com',
    full_name: 'Nadia Rahman',
    block_number: '44B',
    unit_number: '#08-12',
  };

  test('tells the approved resident they can now sign in, and where', async () => {
    await sendResidentApprovedEmail(RESIDENT);

    const mail = sent();
    expect(mail.to).toBe('nadia@example.com');
    expect(mail.subject).toBe('Your EM Services account has been approved');
    expect(mail.text).toContain('Hello Nadia Rahman');
    expect(mail.text).toContain('approved');
    // The address they claimed, so they can spot a mistake before signing in.
    expect(mail.text).toContain('Registered address: Block 44B, Unit #08-12');
    // A link straight to login — the whole point of the message.
    expect(mail.text).toContain('http://localhost/login');
    expect(mail.html).toContain('href="http://localhost/login"');
  });

  test('never includes a password — Supabase holds it and we never see it', async () => {
    await sendResidentApprovedEmail(RESIDENT);

    const mail = sent();
    expect(mail.text).toContain('password you registered with');
    expect(mail.text).not.toMatch(/password:/i);
  });

  test('omits the unit when the resident did not give one', async () => {
    await sendResidentApprovedEmail({ ...RESIDENT, unit_number: null });

    expect(sent().text).toContain('Registered address: Block 44B\n');
  });
});
