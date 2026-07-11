// App theme — light palette built on the estate brand colours.
// Note: #2e2e20 (dark olive) is reserved for the app header on other pages and
// is intentionally not used here.
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
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
    },
    MuiPopover: {
      defaultProps: { disableScrollLock: true },
    },
    MuiDialog: {
      defaultProps: { disableScrollLock: true },
    },
    MuiDrawer: {
      defaultProps: { ModalProps: { disableScrollLock: true } },
    },
  },
  palette: {
    mode: 'light',
    background: {
      default: '#f7f6f2', // soft off-white page background
      paper: '#ffffff',
    },
    primary: {
      main: '#cf3225', // brand red — buttons, links, accents
      dark: '#940000', // hover / darker red
      contrastText: '#ffffff',
    },
    text: {
      secondary: '#b4b4b4', // muted labels / helper text
    },
  },
});

export default theme;
