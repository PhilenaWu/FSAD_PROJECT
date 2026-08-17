// On-demand translation (048) of the OTHER people's free text on a resident's
// own report — closing remark, checklist remarks, history notes — shown on
// ReportCard's expanded detail. Not the resident's own title/description;
// they wrote those themselves. ReportCard is a controlled component (see
// mahdiya/ReportCard.test.jsx), so these drive it purely through props.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import ReportCard from '../../src/components/inspections/ReportCard';

const REPORT = {
  id: 'insp-1',
  title: 'Lift button broken',
  category: 'Lift',
  location_block: '44A',
  status: 'Resolved',
  created_at: '2026-08-08T09:15:00Z',
};

const DETAIL = {
  description: 'Button 3 does not respond',
  closing_remark: 'Replaced the button module.',
  checklist_results: [
    { id: 'chk-1', section: 'B — Lift Car', item_text: 'Door side gaps', result: 'Defect', severity: 'Major', remark: 'Door catches on the sill' },
  ],
  history: [
    { id: 'hist-1', action: 'Reviewed by Inspector', actor_name: 'Wei Jie Tan', created_at: '2026-08-08T10:00:00Z', note: 'Checked, all good' },
  ],
};

function baseProps(overrides = {}) {
  return {
    report: REPORT,
    expanded: true,
    detail: DETAIL,
    detailLoading: false,
    detailError: false,
    onToggle: vi.fn(),
    onRetryDetail: vi.fn(),
    editable: false,
    editing: false,
    editDraft: {},
    editSaving: false,
    editError: null,
    onEditToggle: vi.fn(),
    onEditChange: vi.fn(),
    onEditSave: vi.fn(),
    onEditCancel: vi.fn(),
    preferredLanguage: undefined,
    translation: null,
    showingTranslation: false,
    translating: false,
    translateError: null,
    onTranslate: vi.fn(),
    onToggleShowTranslation: vi.fn(),
    ...overrides,
  };
}

describe('ReportCard — translation control visibility', () => {
  test('hidden entirely with no preferred language set', () => {
    render(<ReportCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /Translate to/i })).not.toBeInTheDocument();
  });

  test('hidden when a language is set but there is nothing to translate', () => {
    const detail = { description: '', closing_remark: null, checklist_results: [], history: [] };
    render(<ReportCard {...baseProps({ detail, preferredLanguage: 'zh' })} />);
    expect(screen.queryByRole('button', { name: /Translate to/i })).not.toBeInTheDocument();
  });

  test('offered when a language is set and there is a closing remark to translate', () => {
    render(<ReportCard {...baseProps({ preferredLanguage: 'zh' })} />);
    expect(screen.getByRole('button', { name: 'Translate to 中文 (Mandarin)' })).toBeInTheDocument();
  });

  test('offered when the only translatable text is a history note', () => {
    const detail = { description: '', closing_remark: null, checklist_results: [], history: DETAIL.history };
    render(<ReportCard {...baseProps({ detail, preferredLanguage: 'ta' })} />);
    expect(screen.getByRole('button', { name: 'Translate to தமிழ் (Tamil)' })).toBeInTheDocument();
  });
});

describe('ReportCard — translation behaviour', () => {
  test('clicking Translate calls onTranslate', async () => {
    const user = userEvent.setup();
    const onTranslate = vi.fn();
    render(<ReportCard {...baseProps({ preferredLanguage: 'zh', onTranslate })} />);

    await user.click(screen.getByRole('button', { name: 'Translate to 中文 (Mandarin)' }));
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  test('shows the translated closing remark, checklist remark, and history note when toggled on', () => {
    const translation = {
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [{ id: 'chk-1', remark: '门卡在门槛上' }],
      history_notes: [{ id: 'hist-1', note: '已检查，一切正常' }],
      was_translated: true,
    };
    render(
      <ReportCard {...baseProps({ preferredLanguage: 'zh', translation, showingTranslation: true })} />
    );

    expect(screen.getByText('已更换按钮模块。')).toBeInTheDocument();
    expect(screen.getByText(/门卡在门槛上/)).toBeInTheDocument();
    expect(screen.getByText('已检查，一切正常')).toBeInTheDocument();
    // The English originals are not shown at the same time.
    expect(screen.queryByText('Replaced the button module.')).not.toBeInTheDocument();
  });

  test('toggling off shows the original text again', () => {
    const translation = {
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [{ id: 'chk-1', remark: '门卡在门槛上' }],
      history_notes: [{ id: 'hist-1', note: '已检查，一切正常' }],
      was_translated: true,
    };
    render(
      <ReportCard {...baseProps({ preferredLanguage: 'zh', translation, showingTranslation: false })} />
    );

    expect(screen.getByText('Replaced the button module.')).toBeInTheDocument();
    expect(screen.getByText(/Door catches on the sill/)).toBeInTheDocument();
    expect(screen.getByText('Checked, all good')).toBeInTheDocument();
  });

  test('clicking the toggle chip calls onToggleShowTranslation', async () => {
    const user = userEvent.setup();
    const onToggleShowTranslation = vi.fn();
    const translation = {
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [],
      history_notes: [],
      was_translated: true,
    };
    render(
      <ReportCard
        {...baseProps({ preferredLanguage: 'zh', translation, showingTranslation: true, onToggleShowTranslation })}
      />
    );

    await user.click(screen.getByText(/Showing:/));
    expect(onToggleShowTranslation).toHaveBeenCalledTimes(1);
  });

  test('states "already in" the language rather than offering a toggle when nothing needed translating', () => {
    const translation = {
      closing_remark: 'Replaced the button module.',
      checklist_remarks: [],
      history_notes: [],
      was_translated: false,
    };
    render(<ReportCard {...baseProps({ preferredLanguage: 'zh', translation })} />);

    expect(screen.getByText(/Already in 中文 \(Mandarin\)/)).toBeInTheDocument();
    expect(screen.queryByText(/^Showing:/)).not.toBeInTheDocument();
  });

  test('a checklist item with no translated entry falls back to the original remark', () => {
    // Only the closing remark was translated (e.g. the checklist item had no
    // remark in the API's translation payload) — item.remark itself stands in.
    const translation = { closing_remark: '已更换按钮模块。', checklist_remarks: [], history_notes: [], was_translated: true };
    render(
      <ReportCard {...baseProps({ preferredLanguage: 'zh', translation, showingTranslation: true })} />
    );

    expect(screen.getByText(/Door catches on the sill/)).toBeInTheDocument();
  });

  test('shows the translation error message when present', () => {
    render(
      <ReportCard {...baseProps({ preferredLanguage: 'zh', translateError: 'Translation is temporarily unavailable. Please try again shortly.' })} />
    );
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  test('shows a busy state while translating', () => {
    render(<ReportCard {...baseProps({ preferredLanguage: 'zh', translating: true })} />);
    expect(screen.getByRole('button', { name: /Translating…/i })).toBeDisabled();
  });
});

describe('ReportCard — category label', () => {
  // Static display translation (categoryLabels.js) for the category enum,
  // shown on the summary line regardless of whether the card is expanded.
  test("shows the category in the resident's display language", () => {
    render(<ReportCard {...baseProps({ expanded: false, preferredLanguage: 'zh' })} />);
    expect(screen.getByText(/电梯 · Block 44A/)).toBeInTheDocument();
  });

  test('stays English with no display language set', () => {
    render(<ReportCard {...baseProps({ expanded: false })} />);
    expect(screen.getByText(/^Lift · Block 44A/)).toBeInTheDocument();
  });
});
