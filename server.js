const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const leadRoutes = require('./routes/leads');
const templateRoutes = require('./routes/templates');
const campaignRoutes = require('./routes/campaigns');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const worker = require('./worker');

const app = express();
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
].filter(Boolean).map(url => url.replace(/\/$/, ''));

// Add www/non-www counterpart of FRONTEND_URL if it is configured
if (process.env.FRONTEND_URL) {
  const cleanUrl = process.env.FRONTEND_URL.replace(/\/$/, '');
  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname && !parsed.hostname.startsWith('www.') && !parsed.hostname.includes('localhost') && !parsed.hostname.includes('127.0.0.1')) {
      allowedOrigins.push(`${parsed.protocol}//www.${parsed.hostname}`);
    } else if (parsed.hostname && parsed.hostname.startsWith('www.')) {
      allowedOrigins.push(`${parsed.protocol}//${parsed.hostname.substring(4)}`);
    }
  } catch (e) {
    // Ignore invalid URL
  }
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }
    return callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'), false);
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key-change-this',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "dist")));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

// React routing support - must be after API routes
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Start the background campaign daemon
  worker.startWorker();
});

// Force restart to load updated env variables

