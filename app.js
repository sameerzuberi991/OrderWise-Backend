import express from 'express';
import cors from 'cors';
import webhookRouter from './routes/webhook.js';
import ordersRouter from './routes/orders.js';
import analyticsRouter from './routes/analytics.js';
import inventoryRouter from './routes/inventory.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.json({ ok: true, service: 'orderwise-server' }));
app.use('/webhook', webhookRouter);
app.use('/orders', ordersRouter);
app.use('/analytics', analyticsRouter);
app.use('/inventory', inventoryRouter);

export default app;
