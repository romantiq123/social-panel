// Локальный режим: MCP по stdio, работает с локальной базой data/
import '../core/paths.ts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.ts';

await createMcpServer().connect(new StdioServerTransport());
