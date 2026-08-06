// Sidebar "FAQ" — static reference content describing how this app's
// existing resident-facing flows actually work (report → status board → my
// reports), not invented policy.
import { Accordion, AccordionDetails, AccordionSummary, Box, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { alpha } from '@mui/material/styles';

const FAQS = [
  {
    q: 'How do I report an issue?',
    a: 'Go to "Report issue" in the sidebar, describe the defect, and select the block/unit it affects. Once submitted, it appears in "My reports" and on the estate status board.',
  },
  {
    q: 'What do the different statuses mean?',
    a: '"Submitted" means it has just come in. "Being reviewed" means it is awaiting assignment. "Contractor assigned" and "In progress" mean work is underway. "Work completed" and "Resolved" mean the fix has been carried out. "Closed" means the record is archived.',
  },
  {
    q: 'Can I see issues reported by other residents?',
    a: 'Yes — the estate status board shows reported issues across the estate without any personal details, so you can see what has already been reported nearby.',
  },
  {
    q: 'How do I check the status of something I reported?',
    a: '"My reports" lists everything you have filed, with its current status and when it was last updated.',
  },
  {
    q: 'Who fixes a reported issue?',
    a: 'Once reviewed, a report is assigned to a contractor appropriate to its category (e.g. lift, plumbing, electrical), who carries out and confirms the work.',
  },
];

export default function FAQPage() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 720, mx: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '50%',
            color: 'secondary.main',
            bgcolor: (t) => alpha(t.palette.secondary.main, 0.12),
          }}
        >
          <HelpOutlineOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Frequently asked questions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            How reporting and tracking issues works.
          </Typography>
        </Box>
      </Stack>

      {FAQS.map(({ q, a }) => (
        <Accordion key={q} variant="outlined" disableGutters sx={{ mb: 1.5, borderRadius: 2, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              {q}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary">
              {a}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
