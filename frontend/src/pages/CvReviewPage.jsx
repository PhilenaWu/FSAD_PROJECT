// UC-007 manual review queue page. IncidentListPage.jsx (UC-002) is still an
// empty stub, so this gives managers a real place to see CV detections until
// that page lands and can absorb this as a tab.
import { Box, Container, Typography } from '@mui/material';
import ManualReviewQueue from '../components/cv/ManualReviewQueue';

export default function CvReviewPage() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 } }}>
      <Container maxWidth="lg">
        <Typography variant="h4" component="h1" fontWeight={700} sx={{ mb: 1 }}>
          CV Review Queue
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Low-confidence defect detections flagged for manual review.
        </Typography>
        <ManualReviewQueue />
      </Container>
    </Box>
  );
}
