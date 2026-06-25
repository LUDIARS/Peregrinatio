import { Hono } from 'hono';
import { config } from '../config.js';

const app = new Hono();

// Google Maps JS API key (referrer 制限前提) と有効フラグ。key 空なら enabled=false。
app.get('/api/map-config', (c) => {
  const apiKey = config.googleMaps.apiKey;
  return c.json({ enabled: apiKey.length > 0, apiKey });
});

export default app;
