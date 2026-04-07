const express = require('express');
const { OpenAI } = require('openai');
const authMiddleware = require('../middleware/auth');
const ChatHistory = require('../models/ChatHistory');
const botStyles = require('../config/botStyles');

const router = express.Router();

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (err) {
  console.log('OpenAI not initialized:', err.message);
}

// In-memory session store for widget chats (no JWT/DB required)
const widgetSessions = new Map();
const MAX_WIDGET_SESSIONS = 50;

// POST /api/chat/widget-stream - Widget-specific streaming (no JWT required)
router.post('/widget-stream', async (req, res) => {
  try {
    const { message, botStyleId, widgetToken } = req.body;

    if (!message || !botStyleId) {
      return res.status(400).json({ error: 'Message and botStyleId are required.' });
    }

    if (!widgetToken) {
      return res.status(401).json({ error: 'Widget token is required.' });
    }

    const bot = botStyles.find(b => b.id === botStyleId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot style not found.' });
    }

    // Use in-memory session keyed by token + bot
    const sessionKey = `${widgetToken}_${botStyleId}`;
    if (!widgetSessions.has(sessionKey)) {
      // Evict oldest session if at capacity
      if (widgetSessions.size >= MAX_WIDGET_SESSIONS) {
        const oldest = widgetSessions.keys().next().value;
        widgetSessions.delete(oldest);
      }
      widgetSessions.set(sessionKey, []);
    }
    const history = widgetSessions.get(sessionKey);

    // Save user message
    history.push({ role: 'user', content: message });

    // Build context (last 20 messages)
    const recentMessages = history.slice(-20);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      // Demo mode
      const demoText = `[${bot.name} Demo] I'm currently in demo mode. Connect an OpenAI API key to unlock my full ${bot.tagline.toLowerCase()} personality!`;
      for (const char of demoText) {
        res.write(`data: ${JSON.stringify({ content: char })}\n\n`);
        await new Promise(r => setTimeout(r, 20));
      }
      res.write(`data: [DONE]\n\n`);
      history.push({ role: 'assistant', content: demoText });
      res.end();
      return;
    }

    try {
      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: bot.personality },
          ...recentMessages
        ],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: 0.85,
        stream: true,
      });

      let fullReply = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullReply += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write(`data: [DONE]\n\n`);
      history.push({ role: 'assistant', content: fullReply });

    } catch (aiError) {
      console.error('Widget OpenAI stream error:', aiError.message);
      const errMsg = `I encountered an issue. Please try again.`;
      res.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      history.push({ role: 'assistant', content: errMsg });
    }

    res.end();
  } catch (error) {
    console.error('Widget stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error during widget chat.' });
    } else {
      res.end();
    }
  }
});

// POST /api/chat/stream - Streaming chat endpoint using SSE
router.post('/stream', authMiddleware, async (req, res) => {
  try {
    const { message, botStyleId } = req.body;

    if (!message || !botStyleId) {
      return res.status(400).json({ error: 'Message and botStyleId are required.' });
    }

    const bot = botStyles.find(b => b.id === botStyleId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot style not found.' });
    }

    // Get or create chat history
    let chatHistory = await ChatHistory.findOne({
      userId: req.userId,
      botStyleId: botStyleId
    });

    if (!chatHistory) {
      chatHistory = new ChatHistory({
        userId: req.userId,
        botStyleId: botStyleId,
        messages: []
      });
    }

    // Save user message immediately
    chatHistory.messages.push({ role: 'user', content: message });

    // Build context (last 20 messages)
    const recentMessages = chatHistory.messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content
    }));

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      // Demo mode: simulate streaming
      const demoText = `[${bot.name} Demo] I'm currently in demo mode. Connect an OpenAI API key to unlock my full ${bot.tagline.toLowerCase()} personality!`;
      for (const char of demoText) {
        res.write(`data: ${JSON.stringify({ content: char })}\n\n`);
        await new Promise(r => setTimeout(r, 20));
      }
      res.write(`data: [DONE]\n\n`);
      chatHistory.messages.push({ role: 'assistant', content: demoText });
      await chatHistory.save();
      res.end();
      return;
    }

    try {
      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: bot.personality },
          ...recentMessages
        ],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: 0.85,
        stream: true,
      });

      let fullReply = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullReply += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write(`data: [DONE]\n\n`);

      // Save complete reply to DB
      chatHistory.messages.push({ role: 'assistant', content: fullReply });
      await chatHistory.save();

    } catch (aiError) {
      console.error('OpenAI stream error:', aiError.message);
      const errMsg = `I encountered an issue. Please try again.`;
      res.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      chatHistory.messages.push({ role: 'assistant', content: errMsg });
      await chatHistory.save();
    }

    res.end();
  } catch (error) {
    console.error('Stream chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error during chat.' });
    } else {
      res.end();
    }
  }
});

// POST /api/chat - Non-streaming fallback
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { message, botStyleId } = req.body;

    if (!message || !botStyleId) {
      return res.status(400).json({ error: 'Message and botStyleId are required.' });
    }

    const bot = botStyles.find(b => b.id === botStyleId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot style not found.' });
    }

    let chatHistory = await ChatHistory.findOne({ userId: req.userId, botStyleId });
    if (!chatHistory) {
      chatHistory = new ChatHistory({ userId: req.userId, botStyleId, messages: [] });
    }

    chatHistory.messages.push({ role: 'user', content: message });
    const recentMessages = chatHistory.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));

    let reply;
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      reply = `[${bot.name} Demo] Demo mode active.`;
    } else {
      const completion = await openai.chat.completions.create({
        messages: [{ role: 'system', content: bot.personality }, ...recentMessages],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: 0.85,
      });
      reply = completion.choices[0].message.content;
    }

    chatHistory.messages.push({ role: 'assistant', content: reply });
    await chatHistory.save();
    res.json({ reply, botStyleId });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Server error during chat.' });
  }
});

// GET /api/chat/history/:botId
router.get('/history/:botId', authMiddleware, async (req, res) => {
  try {
    const chatHistory = await ChatHistory.findOne({ userId: req.userId, botStyleId: req.params.botId });
    if (!chatHistory) return res.json({ messages: [] });
    res.json({ messages: chatHistory.messages });
  } catch (error) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/chat/history/:botId
router.delete('/history/:botId', authMiddleware, async (req, res) => {
  try {
    await ChatHistory.deleteOne({ userId: req.userId, botStyleId: req.params.botId });
    res.json({ message: 'Chat history cleared.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
