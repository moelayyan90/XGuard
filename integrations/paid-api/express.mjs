// npm install express. Configure UPSTREAM_KEY privately before starting.
// Register your HTTPS endpoint with XGuard using the x-api-key auth header.
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
const app = express();
app.use((req, res, next) => {
  const expected = Buffer.from(process.env.UPSTREAM_KEY || '');
  const supplied = Buffer.from(req.get('x-api-key') || '');
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return res.sendStatus(401);
  next();
});
app.get('/data', (_req, res) => res.json({ result: 'Your useful API result' }));
app.listen(Number(process.env.PORT || 3000));
