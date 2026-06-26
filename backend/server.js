// HTTP server + Socket.IO attach + port listen
'use strict';

const app = require('./src/app');
const config = require('./src/config/env');

// TODO: attach Socket.IO to the HTTP server when the real-time feature lands.

app.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT} (${config.NODE_ENV})`);
});
