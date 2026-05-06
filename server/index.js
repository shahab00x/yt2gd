import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import authRoutes from './routes/auth.js';
import transferRoutes from './routes/transfer.js';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'yt2gd-super-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transfer', transferRoutes);

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

const server = app.listen(PORT, () => {
  console.log(`✅ yt2gd server running on http://localhost:${PORT}`);
});

// Capture low-level Node.js HTTP errors (happens before Express)
server.on('clientError', (err, socket) => {
  console.error('[HTTP SERVER ERROR] Client Error:', err.message, 'Code:', err.code);
  if (err.code === 'HPE_HEADER_OVERFLOW' || err.code === 'HPE_INVALID_HEADER_TOKEN') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy(err);
  }
});
