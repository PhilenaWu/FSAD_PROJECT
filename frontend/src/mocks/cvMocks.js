// Mock dataset for the UC-007 manual review queue — used only when USE_MOCK
// is true in services/cvService.js (demo without a running backend/database).
// Shape mirrors the real GET /api/cv/detections response exactly.

export const MOCK_LOW_CONFIDENCE_DETECTIONS = [
  {
    id: 'cv-mock-1',
    image_url:
      'https://londonsurfacerepairs.co.uk/wp-content/uploads/2018/02/london-lift-scratches-polishing-e1517910067345.jpeg',
    defect_class: 'spill',
    confidence: '0.4450',
    bounding_box: { x: 340, y: 210, width: 120, height: 90 },
    source: 'resident_upload',
    status: 'low_confidence',
    detected_at: '2026-07-14T09:15:00.000Z',
  },
  {
    id: 'cv-mock-2',
    image_url:
      'https://londonsurfacerepairs.co.uk/wp-content/uploads/2018/02/london-lift-scratches-polishing-e1517910067345.jpeg',
    defect_class: 'debris',
    confidence: '0.5210',
    bounding_box: { x: 500, y: 380, width: 80, height: 60 },
    source: 'scheduled_scan',
    status: 'low_confidence',
    detected_at: '2026-07-13T22:40:00.000Z',
  },
];
