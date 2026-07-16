// Server-side scheduled-notification dispatch (UC-008). A 60 s setInterval loop
// inside the Express process fires due notifications, so no GitHub Actions
// minutes are spent. UptimeRobot keeps Render warm, so the interval runs
// reliably. Started once from server.js on boot.
'use strict';

const { dispatchDueNotifications } = require('../controllers/notificationController');

function startNotificationDispatcher() {
  const INTERVAL_MS = 60 * 1000; // check every 60 seconds
  setInterval(async () => {
    try {
      await dispatchDueNotifications();
    } catch (err) {
      console.error('[notificationDispatcher] Error:', err.message);
    }
  }, INTERVAL_MS);
  console.log('[notificationDispatcher] Started — checking every 60 s');
}

module.exports = { startNotificationDispatcher };
