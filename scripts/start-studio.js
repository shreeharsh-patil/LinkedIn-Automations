#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cross-platform runner for LinkedCtl Studio
 * Usage:
 *   node scripts/start-studio.js [server|dev|build|test|cli]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '..');
const possibleStudioDirs = [
  resolve(rootDir, 'flow-agent-main'),
  resolve(rootDir, 'apps', 'studio'),
  resolve(rootDir, 'studio'),
];

let studioDir = possibleStudioDirs[0];
for (const dir of possibleStudioDirs) {
  if (existsSync(resolve(dir, 'package.json'))) {
    studioDir = dir;
    break;
  }
}

if (!existsSync(studioDir)) {
  console.error(`[LinkedCtl Studio] Error: Could not locate studio directory at ${studioDir}`);
  process.exit(1);
}

const command = process.argv[2] || 'server';

let npmScript = 'start';
if (command === 'dev') npmScript = 'dev';
else if (command === 'build') npmScript = 'build';
else if (command === 'test') npmScript = 'test';
else if (command === 'cli') npmScript = 'cli';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log(`\n🚀 [LinkedCtl Studio] Running 'npm run ${npmScript}' in ${studioDir}\n`);

const child = spawn(`${npmCmd} run ${npmScript}`, {
  cwd: studioDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: process.env.PORT || '3000',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code || 0);
  }
});
