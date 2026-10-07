import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('telegram-worker.mjs', 'dist/server/index.js');
const hosting = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
await writeFile('dist/.openai/hosting.json', JSON.stringify(hosting, null, 2) + '\n');
console.log('Telegram notification Worker prepared.');
