// HTTP server + Socket.IO attach + port listen
'use strict';

const http = require('http');

const app = require('./src/app');
const config = require('./src/config/env');
const db = require('./src/config/db');
const { initSocket } = require('./src/config/socket');

// Wrap the Express app in a bare HTTP server so Socket.IO can share the port.
const server = http.createServer(app);
initSocket(server);

// Verify the database is reachable before accepting traffic — a backend with no
// database is not healthy, so fail fast with a clear message.
db.testConnection()
  .then(() => {
    console.log('Database connection OK');
    server.listen(config.PORT, () => {
      console.log(`Server listening on port ${config.PORT} (${config.NODE_ENV})`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to the database:', err.message);
    console.error('Check DATABASE_URL in your .env (Supabase pooler, sslmode=require).');
    process.exit(1);
  });
