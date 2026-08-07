// Sidebar "Emergency contacts" — a static reference list, different per role:
// residents see the managing office plus the national emergency lines,
// inspectors see the maintenance line and the estate manager. The values
// themselves live in lib/roleContacts.js, which the sidebar help card reads
// too, so a role's number never disagrees between the two.
import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import { useAuth } from '../context/AuthContext';
import { getRoleContacts } from '../lib/roleContacts';

export default function EmergencyContactsPage() {
  const { profile } = useAuth();
  const {
    contactsTitle = 'Contacts',
    contactsSubtitle,
    contacts = [],
  } = getRoleContacts(profile?.role);

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
            {contactsTitle}
          </Typography>
          {contactsSubtitle && (
            <Typography variant="body2" color="text.secondary">
              {contactsSubtitle}
            </Typography>
          )}
        </Box>
      </Stack>

      <Stack spacing={2}>
        {/* A role nobody has added contacts for yet, rather than a blank page. */}
        {contacts.length === 0 && (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Typography variant="body2" color="text.secondary">
              No contacts have been listed for your role yet.
            </Typography>
          </Paper>
        )}
        {contacts.map(({ label, description, number, icon: Icon, color }) => (
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
