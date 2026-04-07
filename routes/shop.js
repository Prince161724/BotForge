const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const botStyles = require('../config/botStyles');

const router = express.Router();

// GET /api/shop/bots - List all bot styles (public)
router.get('/bots', (req, res) => {
  // Send bot data without the system prompt (keep that server-side only)
  const publicBots = botStyles.map(bot => ({
    id: bot.id,
    name: bot.name,
    tagline: bot.tagline,
    description: bot.description,
    longDescription: bot.longDescription,
    features: bot.features,
    bestFor: bot.bestFor,
    responseStyle: bot.responseStyle,
    chatPosition: bot.chatPosition,
    theme: bot.theme,
    animation: bot.animation,
    price: bot.price,
    featured: bot.featured
  }));
  res.json(publicBots);
});

// POST /api/shop/purchase/:botId - Purchase a bot
router.post('/purchase/:botId', authMiddleware, async (req, res) => {
  try {
    const { botId } = req.params;

    // Validate bot exists
    const bot = botStyles.find(b => b.id === botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot style not found.' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if already purchased
    if (user.purchasedBots.includes(botId)) {
      return res.status(400).json({ error: 'You already own this bot.' });
    }

    user.purchasedBots.push(botId);
    await user.save();

    res.json({
      message: `${bot.name} has been added to your collection!`,
      purchasedBots: user.purchasedBots
    });
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: 'Server error during purchase.' });
  }
});

// GET /api/shop/my-bots - Get user's purchased bots
router.get('/my-bots', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const myBots = botStyles
      .filter(bot => user.purchasedBots.includes(bot.id))
      .map(bot => ({
        id: bot.id,
        name: bot.name,
        tagline: bot.tagline,
        description: bot.description,
        theme: bot.theme,
        animation: bot.animation
      }));

    res.json(myBots);
  } catch (error) {
    console.error('My bots error:', error);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/shop/remove/:botId - Remove a bot from user's collection
router.delete('/remove/:botId', authMiddleware, async (req, res) => {
  try {
    const { botId } = req.params;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!user.purchasedBots.includes(botId)) {
      return res.status(400).json({ error: 'You do not own this bot.' });
    }

    user.purchasedBots = user.purchasedBots.filter(id => id !== botId);
    await user.save();

    // Also clear chat history for this bot
    const ChatHistory = require('../models/ChatHistory');
    await ChatHistory.deleteOne({ userId: req.userId, botStyleId: botId });

    res.json({
      message: 'Bot removed from your collection.',
      purchasedBots: user.purchasedBots
    });
  } catch (error) {
    console.error('Remove bot error:', error);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
