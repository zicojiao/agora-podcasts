#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = [
  ['GEMINI_API_KEY', 'Server-side Gemini key with access to the selected models.'],
  ['NEXT_PUBLIC_AGORA_APP_ID', 'Agora App ID.'],
  ['NEXT_AGORA_APP_CERTIFICATE', 'Agora App Certificate (server-side only).'],
];

const OPTIONAL = [
  ['GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts'],
  ['GEMINI_TEXT_MODEL', 'gemini-3.8-flash'],
];

function readEnvFile() {
  try {
    const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    return Object.fromEntries(
      contents
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          if (separator < 0) return [line, ''];
          // Tolerate quoted values; Next's own dotenv parser strips them too.
          const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
          return [line.slice(0, separator).trim(), value];
        }),
    );
  } catch {
    return null;
  }
}

const fileEnv = readEnvFile();
const env = { ...(fileEnv ?? {}), ...process.env };
const problems = [];

if (!fileEnv) {
  console.log('• No .env.local found — reading the process environment instead.');
}

for (const [name, description] of REQUIRED) {
  if (env[name]?.trim()) {
    console.log(`✓ ${name}`);
  } else {
    problems.push(`${name} is not set — ${description}`);
  }
}

for (const [name, fallback] of OPTIONAL) {
  console.log(`· ${name} = ${env[name]?.trim() || `${fallback} (default)`}`);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) problems.push(`Node 22+ is required; this is ${process.versions.node}.`);
else console.log(`✓ Node ${process.versions.node}`);

if (problems.length) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nCopy env.local.example to .env.local and fill in the blanks.');
  process.exit(1);
}

console.log('\nReady.');
