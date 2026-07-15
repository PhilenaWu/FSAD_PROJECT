// UC-008 read-receipt badge. Polls the receipts endpoint every 30 s and shows
// a live "X of Y read" count for a sent notification.
import { useEffect, useState } from 'react';
import { Chip } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { getReceipts } from '../../services/notificationService';

export default function ReadReceiptBadge({ notificationId }) {
  const [receipts, setReceipts] = useState(null);

  useEffect(() => {
    if (!notificationId) return;
    let active = true;

    async function poll() {
      try {
        const { data } = await getReceipts(notificationId);
        if (active) setReceipts(data);
      } catch {
        // Transient errors are fine — the next tick retries.
      }
    }

    poll();
    const timer = setInterval(poll, 30 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [notificationId]);

  const label = receipts
    ? `${receipts.read_count} of ${receipts.total_recipients} read`
    : 'Loading receipts…';

  return <Chip icon={<DoneAllIcon />} label={label} variant="outlined" />;
}
