// Сборка под Vercel Build Output API (v3): статический UI + одна Node-функция для API.
// Запускается как buildCommand в vercel.json после `vite build`.
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const OUT = '.vercel/output';
const FN = join(OUT, 'functions/index.func');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FN, { recursive: true });

// 1) статика
cpSync('dist/web', join(OUT, 'static'), { recursive: true });

// 2) API: бандлим всё, кроме sharp (нативный модуль — копируем по трассировке)
await build({
  entryPoints: ['src/server/vercel.ts'],
  outfile: join(FN, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['sharp'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

const { fileList } = await nodeFileTrace([join(FN, 'index.mjs')], { base: process.cwd() });
let copied = 0;
for (const f of fileList) {
  if (!f.startsWith('node_modules/')) continue;
  const dest = join(FN, f);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(f, dest, { dereference: true });
  copied++;
}
// sharp грузит бинарники динамически — копируем пакеты целиком
for (const dir of ['node_modules/sharp', 'node_modules/@img', 'node_modules/detect-libc', 'node_modules/semver', 'node_modules/color', 'node_modules/color-string', 'node_modules/color-convert', 'node_modules/color-name', 'node_modules/simple-swizzle', 'node_modules/is-arrayish']) {
  if (existsSync(dir)) cpSync(dir, join(FN, dir), { recursive: true, dereference: true });
}
// лишние сборки libvips (musl/wasm) Vercel не нужны
for (const d of ['sharp-libvips-linuxmusl-x64', 'sharp-linuxmusl-x64', 'sharp-wasm32', 'sharp-libvips-linuxmusl-arm64', 'sharp-linuxmusl-arm64']) {
  rmSync(join(FN, 'node_modules/@img', d), { recursive: true, force: true });
}
console.log(`nft: скопировано файлов ${copied}`);

writeFileSync(
  join(FN, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 300, memory: 1024, regions: ['fra1'] }, null, 2),
);

// 3) маршруты: API/OAuth/MCP → функция, остальное — статика с SPA-фолбэком
writeFileSync(
  join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/(api|oauth|mcp|mcp-auth|media|\\.well-known)(/.*)?$', dest: '/index' },
        { src: '^/$', dest: '/index.html' },
        { handle: 'filesystem' },
        { src: '/.*', dest: '/index.html' },
      ],
      crons: [],
    },
    null,
    2,
  ),
);
console.log('Vercel build output готов:', relative(process.cwd(), OUT));
