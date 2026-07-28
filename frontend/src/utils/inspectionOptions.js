// Shared enum values mirroring the inspections table's CHECK constraints
// (migration 004). Single source so category/priority stay consistent across
// InspectionListPage, InspectionDetailPage, and the CV manual-review dialog.
export const CATEGORIES = [
  'Structural', 'Electrical', 'Plumbing', 'Cleanliness', 'Lift', 'Doors',
  'Cabin', 'Safety', 'Landscaping', 'Pest', 'Other', 'Uncategorised',
];

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
