// Локальный режим: MCP по stdio, работает с той же базой (DATABASE_URL в .env)
import '../core/paths.ts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureSchema } from '../core/db.ts';
import { loadSettings } from '../core/settings.ts';
import { initAuth } from '../server/auth.ts';
import { createMcpServer } from './server.ts';

await ensureSchema();
await loadSettings();
await initAuth();
await createMcpServer().connect(new StdioServerTransport());
