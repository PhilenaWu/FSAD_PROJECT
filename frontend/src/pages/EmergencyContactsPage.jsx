// Sidebar "Emergency contacts" — static reference list. The managing office
// number is the estate's actual contact; Police/Fire & Ambulance are
// Singapore's national emergency numbers, included for genuine safety value
// (not app-specific data, so nothing here is invented).
import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import LocalPoliceOutlinedIcon from '@mui/icons-material/LocalPoliceOutlined';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';

const CONTACTS = [
  {
    label: 'Managing office',
    description: 'Estate maintenance, lift faults, general enquiries',
    number: '6500 0300',
    icon: ApartmentOutlinedIcon,
    color: 'primary',
  },
  {
    label: 'Police',
    description: 'National emergency line',
    number: '999',
    icon: LocalPoliceOutlinedIcon,
    color: 'info',
  },
  {
    label: 'Fire & Ambulance',
    description: 'National emergency line',
    number: '995',
    icon: LocalFireDepartmentOutlinedIcon,
    color: 'error',
  },
];

export default function EmergencyContactsPage() {
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
            color: 'error.main',
            bgcolor: (t) => alpha(t.palette.error.main, 0.12),
          }}
        >
          <LocalPhoneOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Emergency contacts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For urgent estate issues or emergencies.
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={2}>
        {CONTACTS.map(({ label, description, number, icon: Icon, color }) => (
          <Paper
            key={label}
            variant="outlined"
            sx={{ p: 2.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: '50%',
                flexShrink: 0,
                color: `${color}.main`,
                bgcolor: (t) => alpha(t.palette[color].main, 0.12),
              }}
            >
              <Icon fontSize="small" />
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                {label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            </Box>
            <Typography
              component="a"
              href={`tel:${number.replace(/\s+/g, '')}`}
              variant="h6"
              fontWeight={700}
              sx={{ color: `${color}.main`, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              {number}
            </Typography>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
