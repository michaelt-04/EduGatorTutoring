const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { testConnection } = require('./src/config/db');

const app = express();

app.use(cors({
  origin: true, 
  credentials: true
}));

app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'edugator-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend/src')));

// API routes
app.use('/', require('./src/routes'));

const PORT = process.env.PORT || 3000;

// Start server and test database connection
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  await testConnection();
});
