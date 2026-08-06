// App theme — enterprise SaaS look (Linear / Microsoft Fluent inspired):
// Inter typeface, dark navy sidebar, blue primary action colour, a small
// semantic palette (red/orange/green/purple) reserved for status only,
// 12px radius, soft shadows, subtle hover micro-interactions.
// Palette/typography/shape/interaction-polish only — no component behaviour
// changes.
import { createTheme } from '@mui/material/styles';

// Single soft shadow used for every card/menu/popover instead of MUI's
// default harsh multi-layer elevation shadows.
const softShadow = '0 1px 2px rgba(16, 24, 40, 0.06), 0 2px 8px rgba(16, 24, 40, 0.06)';
const liftShadow = '0 4px 12px rgba(16, 24, 40, 0.12)';

const theme = createTheme({
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  palette: {
    mode: 'light',
    background: {
      default: '#F8FAFC',
      paper: '#ffffff',
    },
    // Blue is the interactive/action colour (buttons, links, active nav).
    // Navy is structural (sidebar). Red/orange/green/purple are reserved for
    // status semantics (overdue, in-review, resolved, AI/contractor accents)
    // rather than doubling as the brand's primary action colour.
    primary: {
      main: '#2563EB',
      dark: '#1D4ED8',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#7C3AED',
      dark: '#6D28D9',
      contrastText: '#ffffff',
    },
    info: {
      main: '#0891B2',
      dark: '#0E7490',
      contrastText: '#ffffff',
    },
    success: {
      main: '#16A34A',
      dark: '#15803D',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#D97706',
      dark: '#B45309',
      contrastText: '#ffffff',
    },
    error: {
      main: '#DC2626',
      dark: '#B91C1C',
      contrastText: '#ffffff',
    },
    divider: '#E5E7EB',
    text: {
      primary: '#111827',
      secondary: '#6B7280',
    },
    // Not a standard MUI palette key — consumed directly by AppShell for the
    // navy sidebar so its colours stay themed (not hard-coded hex in the
    // component) without forcing the whole app into dark mode.
    sidebar: {
      bg: '#0B1E3D',
      hoverBg: 'rgba(255, 255, 255, 0.06)',
      activeBg: 'rgba(37, 99, 235, 0.35)',
      text: '#AAB6CC',
      textActive: '#FFFFFF',
      border: 'rgba(255, 255, 255, 0.08)',
    },
  },
  components: {
    // Keep the viewport width constant everywhere so the header never shifts
    // or leaves a right-edge gap:
    // 1. Always show the page scrollbar (even on short pages), so navigating
    //    between scrolling and non-scrolling pages doesn't change the width.
    MuiCssBaseline: {
      styleOverrides: {
        html: { overflowY: 'scroll' },
      },
    },
    // 2. Don't let popups lock body scroll — the lock hides the scrollbar and
    //    pads the body, shifting the header sideways while a menu is open.
    //    defaultProps don't cascade from Modal to its wrappers, so each popup
    //    component gets its own default.
    MuiMenu: {
      defaultProps: { disableScrollLock: true },
      styleOverrides: {
        paper: { boxShadow: softShadow, border: '1px solid #E5E7EB' },
      },
    },
    MuiPopover: {
      defaultProps: { disableScrollLock: true },
    },
    MuiDialog: {
      defaultProps: { disableScrollLock: true },
      styleOverrides: {
        paper: { boxShadow: softShadow },
      },
    },
    MuiDrawer: {
      defaultProps: { ModalProps: { disableScrollLock: true } },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: '#E5E7EB' },
        elevation1: { boxShadow: softShadow },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #E5E7EB',
          boxShadow: softShadow,
          transition: 'box-shadow 0.15s ease, transform 0.15s ease',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          transition: 'transform 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease',
        },
        contained: {
          '&:hover': { boxShadow: liftShadow, transform: 'translateY(-1px)' },
          '&:active': { transform: 'translateY(0)' },
        },
        outlined: {
          '&:hover': { transform: 'translateY(-1px)' },
          '&:active': { transform: 'translateY(0)' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { transition: 'background-color 0.12s ease, transform 0.12s ease' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: '#F8FAFC',
          color: '#374151',
          fontWeight: 600,
          fontSize: '0.8125rem',
        },
        root: { borderColor: '#E5E7EB' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.12s ease',
          '&:hover td': { backgroundColor: '#F8FAFC' },
        },
      },
    },
    // MUI's Skeleton defaults to a static "pulse" fade; "wave" reads as more
    // alive during data fetches, at zero cost to every existing <Skeleton/>.
    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { transition: 'background-color 0.12s ease, color 0.12s ease' },
      },
    },
  },
});

export default theme;
