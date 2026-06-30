// App theme — light palette built on the estate brand colours.
// Note: #2e2e20 (dark olive) is reserved for the app header on other pages and
// is intentionally not used here.
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
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
