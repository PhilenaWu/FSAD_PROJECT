// Defect category (migration 004 CHECK) -> icon + theme colour, for the
// small colored badge shown per row on tables/lists. Display-only mapping —
// the DB enum is untouched. Mirrors statusDisplay.js / priorityDisplay.js.
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import ElevatorOutlinedIcon from '@mui/icons-material/ElevatorOutlined';
import SensorDoorOutlinedIcon from '@mui/icons-material/SensorDoorOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';

export const CATEGORY_DISPLAY = {
  Structural: { icon: ConstructionOutlinedIcon, color: 'secondary' },
  Electrical: { icon: BoltOutlinedIcon, color: 'warning' },
  Plumbing: { icon: WaterDropOutlinedIcon, color: 'info' },
  Cleanliness: { icon: CleaningServicesOutlinedIcon, color: 'success' },
  Lift: { icon: ElevatorOutlinedIcon, color: 'primary' },
  Doors: { icon: SensorDoorOutlinedIcon, color: 'secondary' },
  Cabin: { icon: Inventory2OutlinedIcon, color: 'info' },
  Safety: { icon: HealthAndSafetyOutlinedIcon, color: 'error' },
  Landscaping: { icon: ParkOutlinedIcon, color: 'success' },
  Pest: { icon: BugReportOutlinedIcon, color: 'error' },
  Other: { icon: CategoryOutlinedIcon, color: 'secondary' },
  Uncategorised: { icon: WarningAmberOutlinedIcon, color: 'warning' },
};

// Unknown/new categories fall through unmapped rather than breaking the UI.
// `color` is always a real palette key (never MUI Chip's 'default'), since
// callers also use it to tint a custom icon badge, not just <Chip color>.
export function categoryDisplay(category) {
  return CATEGORY_DISPLAY[category] ?? { icon: CategoryOutlinedIcon, color: 'secondary' };
}
