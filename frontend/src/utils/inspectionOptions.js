// Shared enum values mirroring the inspections table's CHECK constraints
// (migration 004, category reworked in 042). Single source so category/priority
// stay consistent across the resident report form, InspectionListPage,
// InspectionDetailPage, the history page, and the CV manual-review dialog.
// 'Miscellaneous' replaced both 'Other' and 'Uncategorised': residents now
// choose the category themselves, so one catch-all they can pick deliberately
// says more than two the system fell back to.
export const CATEGORIES = [
  'Structural', 'Electrical', 'Plumbing', 'Cleanliness', 'Lift', 'Doors',
  'Cabin', 'Safety', 'Landscaping', 'Pest', 'Miscellaneous',
];

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Manager queue tabs — the live statuses grouped by what the manager has to do
// about them, which is the question they actually open the queue to answer.
// 'Closed' is absent by design: closing archives the record (is_deleted = TRUE)
// and it moves to the history page, so a "Closed" tab here would always be
// empty. `statuses` is sent to the API as a comma-separated ?status= list.
export const QUEUE_TABS = [
  { key: 'all', label: 'All open', statuses: [] },
  { key: 'needs-action', label: 'Needs action', statuses: ['Open', 'Pending Assignment'] },
  { key: 'in-progress', label: 'In progress', statuses: ['Assigned', 'Acknowledged', 'On Hold'] },
  { key: 'awaiting', label: 'Awaiting endorsement', statuses: ['Rectified', 'Resolved'] },
];
