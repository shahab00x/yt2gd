import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { clearTmp } from './services/downloader.js';
import authRoutes from './routes/auth.js';
import transferRoutes from './routes/transfer.js';
import systemRoutes from './routes/system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Global request logger for debugging
app.use((req, res, next) => {
  console.log(`[SERVER] Incoming request: ${req.method} ${req.originalUrl}`);
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: 'yt2gd-super-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/system', systemRoutes);

// Serve the Vite production build (when running in production)
const clientDistPath = join(__dirname, '../client/dist');
if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', {
    message: err.message,
    stack: err.stack,
    status: err.status
  });
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Clear tmp directory on startup
clearTmp();

app.listen(PORT, () => {
  console.log(`✅ yt2gd server running on http://localhost:${PORT}`);
});
