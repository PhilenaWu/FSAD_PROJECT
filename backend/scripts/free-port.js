// Frees a TCP port before the dev server binds to it, so a leftover
// `node --watch` process from a previous session (Windows' "Terminate batch
// job (Y/N)?" kills the cmd wrapper, not always the underlying node.exe)
// doesn't cause EADDRINUSE on the next `npm run dev`.
//
// Only kills processes actually named node/node.exe — never touches
// anything else that might happen to hold the port. Always exits 0 (even on
// error) since this runs as `predev`: failing here must never block `dev`
// from starting.
'use strict';

const { execSync } = require('child_process');

const port = process.argv[2];
if (!port) {
  console.error('[free-port] Usage: node scripts/free-port.js <port>');
  process.exit(0);
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

try {
  if (process.platform === 'win32') {
    // netstat lines for a LISTENING socket on this port end with the PID.
    const out = run(`netstat -ano -p TCP`);
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && m[1] === String(port)) pids.add(m[2]);
    }
    for (const pid of pids) {
      try {
        const name = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
        if (!/^"node\.exe"/i.test(name.trim())) continue; // safety: node only
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[free-port] Killed stray node process (PID ${pid}) on port ${port}`);
      } catch {
        // Process may have already exited between listing and killing — fine.
      }
    }
  } else {
    // macOS/Linux: lsof lists PIDs holding the port; filter to node by name.
    const out = run(`lsof -ti tcp:${port}`).trim();
    if (out) {
      for (const pid of out.split('\n').filter(Boolean)) {
        try {
          const name = run(`ps -p ${pid} -o comm=`).trim();
          if (!/node$/i.test(name)) continue; // safety: node only
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`[free-port] Killed stray node process (PID ${pid}) on port ${port}`);
        } catch {
          // Process may have already exited between listing and killing — fine.
        }
      }
    }
  }
} catch {
  // Nothing listening on the port (netstat/lsof exit non-zero when empty) —
  // that's the common case, not an error.
}
