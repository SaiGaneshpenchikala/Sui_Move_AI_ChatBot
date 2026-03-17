import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { chatRouter } from './routes/chat.js';
import { pointsRouter } from './routes/points.js';
import { tokenRouter } from './routes/token.js';
import { conversationRouter } from './routes/conversation.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '64kb' }));

// Rate limiting — 30 requests/minute per IP
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));

// Routes
app.use('/api/chat', chatRouter);
app.use('/api/points', pointsRouter);
app.use('/api/token', tokenRouter);
app.use('/api/conversation', conversationRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✅ Sui AI Chat backend running on port ${PORT}`);
  console.log(`   Network: ${process.env.SUI_NETWORK || 'testnet'}`);
  console.log(`   Package: ${process.env.PACKAGE_ID || '(not set)'}`);
});
