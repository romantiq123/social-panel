// Точка входа функции Vercel (Node.js runtime)
import { getRequestListener } from '@hono/node-server';
import { app } from './app.ts';

export default getRequestListener(app.fetch);
