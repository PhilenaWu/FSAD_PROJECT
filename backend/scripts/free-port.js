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
const fs = require('fs');

const port = process.argv[2];
if (!port) {
  console.error('[free-port] Usage: node scripts/free-port.js <port>');
  process.exit(0);
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// Windows tools by absolute path. A PATH missing bare `C:\Windows\System32`
// (only its subfolders present — Wbem, WindowsPowerShell, OpenSSH) is a common
// broken setup, and there `netstat` resolves to nothing. The outer catch below
// then read "command not found" as "nothing listening", so this script became a
// silent no-op and every stale server surfaced as EADDRINUSE instead.
const sys32 = `${process.env.SystemRoot || 'C:\\Windows'}\\System32`;
const netstatExe = `${sys32}\\netstat.exe`;
const NETSTAT = `"${netstatExe}"`;
const TASKLIST = `"${sys32}\\tasklist.exe"`;
const TASKKILL = `"${sys32}\\taskkill.exe"`;

// Checked up front rather than inferred from a failure: cmd.exe reports a
// missing program on stderr (which `run` discards) and exits non-zero, so a
// missing tool is indistinguishable from "nothing listening" once it throws.
if (process.platform === 'win32' && !fs.existsSync(netstatExe)) {
  console.warn(
    `[free-port] Skipping the port ${port} check — ${netstatExe} not found. ` +
      'If dev now fails with EADDRINUSE, kill the stale node process by hand.'
  );
  process.exit(0);
}

try {
  if (process.platform === 'win32') {
    // netstat lines for a LISTENING socket on this port end with the PID.
    const out = run(`${NETSTAT} -ano -p TCP`);
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && m[1] === String(port)) pids.add(m[2]);
    }
    for (const pid of pids) {
      try {
        const name = run(`${TASKLIST} /FI "PID eq ${pid}" /FO CSV /NH`);
        if (!/^"node\.exe"/i.test(name.trim())) continue; // safety: node only
        execSync(`${TASKKILL} /PID ${pid} /F`, { stdio: 'ignore' });
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
  // that's the common case, not an error. The one failure that used to hide
  // here — the tool itself being unavailable — is caught by the existsSync
  // check above, so this stays quiet.
}
