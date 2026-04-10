require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const shopRoutes = require('./routes/shop');
const chatRoutes = require('./routes/chat');
const supportRoutes = require('./routes/support');
const widgetRoutes = require('./routes/widget');
const trainingRoutes = require('./routes/training');

const app = express();
const port = process.env.PORT || 5000;

// Trust proxy (Render, Heroku, etc. sit behind a reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: function (origin, callback) { callback(null, true); },
  credentials: true
}));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB — chatbot_store'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('Server will continue without database. Some features may not work.');
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/support', supportRoutes);
app.use('/widget.js', widgetRoutes);
app.use('/api/training', trainingRoutes);
// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.listen(port, () => {
  console.log(`🚀 Backend server running on http://localhost:${port}`);
});
