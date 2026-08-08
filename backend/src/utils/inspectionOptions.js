// The inspections.category enum (migration 004, reworked in 042), shared by
// every route that accepts a category: the resident's report, the manager's
// triage PATCH, and the CV manual-review ticket. Mirrors the frontend's own
// list in frontend/src/utils/inspectionOptions.js.
//
// It lives here rather than in inspectionController because cvController needs
// it too, and inspectionController already requires cvController — importing
// the other way would close the loop.
'use strict';

const CATEGORIES = [
  'Structural', 'Electrical', 'Plumbing', 'Cleanliness', 'Lift', 'Doors',
  'Cabin', 'Safety', 'Landscaping', 'Pest', 'Miscellaneous',
];

module.exports = { CATEGORIES };
