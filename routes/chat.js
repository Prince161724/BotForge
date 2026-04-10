const express = require('express');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const authMiddleware = require('../middleware/auth');
const ChatHistory = require('../models/ChatHistory');
const User = require('../models/User');
const botStyles = require('../config/botStyles');

// Import widget training store to check if a widget has been trained
let trainingStore, buildWidgetNamespace;
try {
  const training = require('./training');
  trainingStore = training.trainingStore;
  buildWidgetNamespace = training.buildNamespace;
} catch (e) {
  trainingStore = new Map();
  buildWidgetNamespace = (token, botId) => `${token}_${botId}`;
}

const router = express.Router();

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (err) {
  console.log('OpenAI not initialized:', err.message);
}

// Pinecone client (lazy init)
let pinecone;
function getPinecone() {
  if (!pinecone && process.env.PINECONE_API_KEY) {
    pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return pinecone;
}

// ── RAG Helper: Query Pinecone for relevant context ─────
async function getRAGContext(query, namespace) {
  try {
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    });
    const queryVector = embeddingRes.data[0].embedding;

    const pc = getPinecone();
    if (!pc) return null;

    const index = pc.Index(process.env.PINECONE_INDEX);
    const ns = index.namespace(namespace);

    const results = await ns.query({
      topK: 10,
      vector: queryVector,
      includeMetadata: true
    });

    if (!results.matches || results.matches.length === 0) return null;

    // Use a low threshold so loosely-related questions still get context
    const context = results.matches
      .filter(m => m.score > 0.1)
      .map(m => m.metadata?.text || '')
      .filter(t => t.length > 0)
      .join('\n---\n');

    // If nothing passes even 0.1, fall back to top 3 results anyway
    if (context.length === 0) {
      const fallback = results.matches
        .slice(0, 3)
        .map(m => m.metadata?.text || '')
        .filter(t => t.length > 0)
        .join('\n---\n');
      return fallback.length > 0 ? fallback : null;
    }

    return context;
  } catch (err) {
    console.error('RAG context error:', err.message);
    return null;
  }
}

// ── Check if user has trained this bot ──────────────────
async function getTrainingInfo(userId, botId) {
  try {
    const user = await User.findById(userId);
    if (!user) return null;
    const training = user.trainedBots.find(
      t => t.botId === botId && t.status === 'ready'
    );
    return training || null;
  } catch (err) {
    return null;
  }
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
      // ── CHECK FOR WIDGET RAG MODE ──────────────────
      const widgetNamespace = buildWidgetNamespace(widgetToken, botStyleId);
      const widgetTraining = trainingStore.get(widgetNamespace);
      let systemPrompt = bot.personality;
      let ragMode = false;

      if (widgetTraining && widgetTraining.status === 'ready') {
        const ragContext = await getRAGContext(message, widgetNamespace);

        if (ragContext) {
          ragMode = true;
          systemPrompt = `You are ${bot.name}, an AI assistant trained on a user's uploaded document.

Your primary source of information is the document context provided below. Use it to answer questions directly OR loosely related to the document's topics — you do NOT need an exact match. Use your understanding to connect the user's question to what is in the document, even if the phrasing is different.

Only if a question is completely unrelated to the document should you say: "This topic doesn't appear to be covered in your uploaded document."

Stay in character as ${bot.name} with the following personality traits: ${bot.personality.substring(0, 200)}

DOCUMENT CONTEXT:
${ragContext}

GUIDELINES:
- Be thorough and detailed when the context supports it
- Use inference and reasoning to answer related questions, not just exact matches
- Cite or paraphrase specific parts of the document when helpful
- Maintain ${bot.name}'s personality and tone while answering`;
        } else {
          ragMode = true;
          systemPrompt = `You are ${bot.name}, an AI assistant trained on a user's uploaded document. The document has been processed but no relevant sections could be retrieved for this query. Do your best to help the user — if you genuinely cannot answer from the document's scope, let them know kindly and suggest rephrasing. Maintain ${bot.name}'s personality and tone.`;
        }

        // Send RAG mode indicator
        res.write(`data: ${JSON.stringify({ ragMode: true, fileName: widgetTraining.fileName })}\n\n`);
      }

      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages
        ],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: ragMode ? 0.5 : 0.85,
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

    // ── ENFORCE 3-QUESTION LIMIT (check BEFORE SSE starts) ──────────────
    const trainingInfo = await getTrainingInfo(req.userId, botStyleId);
    if (trainingInfo) {
      const userMsgCount = chatHistory.messages.filter(m => m.role === 'user').length;
      if (userMsgCount >= 3) {
        return res.status(429).json({ limitReached: true });
      }
    }

    // Push user message
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
      // ── CHECK FOR RAG MODE ──────────────────────────
      let systemPrompt;
      let ragMode = false;

      if (trainingInfo) {
        // User has trained this bot with a PDF → RAG mode
        const ragContext = await getRAGContext(message, trainingInfo.namespace);

        if (ragContext) {
          ragMode = true;
          systemPrompt = `You are ${bot.name}, an AI assistant trained on a user's uploaded document.

Your primary source of information is the document context provided below. Use it to answer questions directly OR loosely related to the document's topics — you do NOT need an exact match. Use your understanding to connect the user's question to what is in the document, even if the phrasing is different.

Only if a question is completely unrelated to the document should you say: "This topic doesn't appear to be covered in your uploaded document."

Stay in character as ${bot.name} with the following personality traits: ${bot.personality.substring(0, 200)}

DOCUMENT CONTEXT:
${ragContext}

GUIDELINES:
- Be thorough and detailed when the context supports it
- Use inference and reasoning to answer related questions, not just exact matches
- Cite or paraphrase specific parts of the document when helpful
- Maintain ${bot.name}'s personality and tone while answering`;
        } else {
          // Trained but nothing retrieved — still try to help
          ragMode = true;
          systemPrompt = `You are ${bot.name}, an AI assistant trained on a user's uploaded document. The document has been processed but no relevant sections could be retrieved for this query. Do your best to help the user — if you genuinely cannot answer from the document's scope, let them know kindly and suggest rephrasing. Maintain ${bot.name}'s personality and tone.`;
        }

        // Send RAG mode indicator as first event
        res.write(`data: ${JSON.stringify({ ragMode: true, fileName: trainingInfo.fileName })}\n\n`);
      } else {
        // Normal mode — use bot's personality
        systemPrompt = bot.personality;
      }

      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages
        ],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: ragMode ? 0.5 : 0.85, // Lower temp for RAG accuracy
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

    // ── ENFORCE 3-QUESTION LIMIT BEFORE PUSHING MESSAGE ──────────────
    const trainingInfoFallback = await getTrainingInfo(req.userId, botStyleId);
    if (trainingInfoFallback) {
      const userMsgCount = chatHistory.messages.filter(m => m.role === 'user').length;
      if (userMsgCount >= 3) {
        return res.status(429).json({ limitReached: true });
      }
    }

    chatHistory.messages.push({ role: 'user', content: message });
    const recentMessages = chatHistory.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));

    let reply;
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      reply = `[${bot.name} Demo] Demo mode active.`;
    } else {
      const trainingInfo = trainingInfoFallback;
      let systemPrompt = bot.personality;

      if (trainingInfo) {
        const ragContext = await getRAGContext(message, trainingInfo.namespace);
        if (ragContext) {
          systemPrompt = `You are ${bot.name}, an AI assistant trained on a user's uploaded document.

Use the document context below as your primary source. Answer questions directly or loosely related to the document — use inference and reasoning, not just exact matches. Only say the topic isn't covered if it is completely unrelated to the document.

DOCUMENT CONTEXT:
${ragContext}`;
        }
      }

      const completion = await openai.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, ...recentMessages],
        model: 'gpt-3.5-turbo',
        max_tokens: 600,
        temperature: trainingInfo ? 0.3 : 0.85,
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
    const [chatHistory, trainingInfo] = await Promise.all([
      ChatHistory.findOne({ userId: req.userId, botStyleId: req.params.botId }),
      getTrainingInfo(req.userId, req.params.botId)
    ]);
    const messages = chatHistory ? chatHistory.messages : [];
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    res.json({
      messages,
      isTrained: !!trainingInfo,
      userMessageCount
    });
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

