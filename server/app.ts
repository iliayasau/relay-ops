import express from 'express';
import { ZodError } from 'zod';
import { DomainError, openStore } from './store.ts';
export function createApp(store: ReturnType<typeof openStore>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
  app.get('/api/snapshot', (_req,res) => res.json(store.snapshot()));
  app.post('/api/incidents', (req,res) => { res.status(201).json(store.create(req.body)); });
  app.patch('/api/incidents/:id', (req,res) => { const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw new DomainError(400,'Invalid incident identifier.'); res.json(store.update(id, req.body)); });
  app.use('/api', (_req,res) => { res.status(404).json({ error: 'Endpoint not found.' }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) { res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    if (error instanceof DomainError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Request must contain valid JSON.' }); return; }
    if (typeof error === 'object' && error && 'status' in error && error.status === 413) { res.status(413).json({error:'Request body is too large.'}); return; }
    console.error(error); res.status(500).json({ error: 'Unable to save changes. Please try again.' });
  });
  return app;
}
