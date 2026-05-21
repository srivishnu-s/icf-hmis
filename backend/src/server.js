require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Security Middleware ──────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://celebrated-jelly-099a50.netlify.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any netlify.app subdomain
    if (origin.endsWith('.netlify.app')) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/dashboard',      require('./routes/dashboard'));
app.use('/api/employees',      require('./routes/employees'));
app.use('/api/shops',          require('./routes/shops'));
app.use('/api/analytics',      require('./routes/analytics'));
app.use('/api/sse-monitoring', require('./routes/sseMonitoring'));
app.use('/api/reports',        require('./routes/reports'));
app.use('/api/notifications',  require('./routes/notifications'));

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'ICF HMIS API is running ✅', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚂 ================================================');
  console.log('   ICF HMIS Backend Server Started');
  console.log('🚂 ================================================');
  console.log(`📊 API:    http://localhost:${PORT}/api`);
  console.log(`❤️  Health: http://localhost:${PORT}/api/health`);
  console.log(`🔑 Login:  POST /api/auth/login`);
  console.log(`📝 Demo:   username=admin  password=Admin@123`);
  console.log('🚂 ================================================\n');
});

module.exports = app;
