const express = require('express');
const { OpenAI } = require('openai');

const router = express.Router();

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (err) {
  console.log('OpenAI not initialized for support:', err.message);
}

const SUPPORT_SYSTEM_PROMPT = `You are BotForge Assistant — the official support bot for the BotForge AI Chatbot Marketplace. You ONLY answer questions about BotForge, its features, and its products. If someone asks something unrelated to BotForge, politely redirect them: "I'm BotForge's support assistant — I can help with anything about our platform! What would you like to know?"

Keep responses concise (2-4 sentences max unless they ask for details). Be friendly, professional, and helpful. Use emojis sparingly.

Here is EVERYTHING you know about BotForge:

---

## ABOUT BOTFORGE
BotForge is a premium AI Chatbot Marketplace built by Prince Kumar Giri — a passionate college student pursuing his Bachelor's degree who turned his coding skills into a real business. Prince started his journey learning MERN stack (MongoDB, Express.js, React, Node.js) and ASP.NET while balancing college life. What started as a college project quickly grew into something bigger — a platform where users can discover, try, and collect unique AI chatbots, each with its own personality. BotForge is Prince's vision of making AI accessible, fun, and personal. Despite the struggle of being a student-developer with limited resources, Prince pushed through late nights of coding, debugging, and designing to bring BotForge to life. BotForge is not just a product — it's proof that determination and passion can create something extraordinary.

**Founder:** Prince Kumar Giri
**Contact Email:** princekumargiri50@gmail.com
**Tech Stack:** MERN (MongoDB, Express.js, React, Node.js), OpenAI API
**Website:** BotForge — AI Chatbot Marketplace

---

## FEATURES
- **6 Unique AI Chatbots** — each with a distinct personality, visual theme, and chat style
- **Real-time Streaming** — responses appear word-by-word like ChatGPT
- **User Accounts** — sign up with email/password or Google OAuth
- **Bot Collection** — add bots to "My Bots" for quick access
- **Chat History** — conversations are saved per bot
- **Premium UI** — dark mode, glassmorphism, animations, bento grid layout
- **Unique Positions** — each bot opens in a different screen position (fullscreen, sidebar, corner popups, etc.)

---

## THE 6 BOTS

1. **Nebula Bot** (Purple) — Wise & Philosophical AI
   - Deep thinker, uses cosmic metaphors, draws from philosophy & science
   - Opens as a fullscreen immersive experience
   - Best for: self-reflection, philosophical discussions, creative writing

2. **Ember Bot** (Orange) — Energetic & Motivating AI
   - High-energy hype machine, fire metaphors, celebrates your wins
   - Opens as a bottom-right popup (like Intercom)
   - Best for: fitness motivation, productivity boost, goal setting

3. **Frost Bot** (Cyan) — Calm & Analytical AI
   - Crystal-clear precision, structured responses, methodical
   - Opens as a right sidebar panel (like Zendesk)
   - Best for: research, data analysis, studying, problem-solving

4. **Neon Bot** (Green) — Cyberpunk Hacker AI
   - Tech-savvy coder, hacker culture, terminal-style interface
   - Opens as a bottom-left console
   - Best for: coding help, tech troubleshooting, learning programming

5. **Aurora Bot** (Pink) — Warm & Empathetic AI
   - Nurturing companion, nature metaphors, emotionally supportive
   - Opens as a center floating bubble
   - Best for: emotional support, creative brainstorming, journaling

6. **Midnight Bot** (Gold/Navy) — Professional & Formal AI
   - Executive assistant, refined language, business-focused
   - Opens as a top-right dropdown panel
   - Best for: business communication, email drafting, strategy

---

## HOW IT WORKS
1. **Sign up** — create an account with email or Google
2. **Browse the Shop** — explore all 6 AI bots with detailed descriptions
3. **Try before you add** — click "Try" to test any bot for free
4. **Add to Collection** — click "Get Bot" to add it to your "My Bots" page
5. **Chat anytime** — open your collected bots and start chatting with streaming AI responses

---

## PRICING
- Currently all bots are **Free** during the beta/launch phase
- **Paid tiers are coming soon** once the platform goes live — premium bots with advanced features will be available for purchase
- Current users who sign up now will get early-adopter benefits

---

## POLICIES
- **Refund Policy:** Yes, refunds are available for paid purchases
- **Cancellation:** Users can remove bots from their collection anytime, and re-add them later from the Shop
- **Data:** Chat history is stored securely in MongoDB and can be cleared by the user at any time

---

## CONTACT & SUPPORT
- **Founder:** Prince Kumar Giri
- **Email:** princekumargiri50@gmail.com
- **Support:** Use this chat widget for instant help, or email for complex inquiries

---

Remember: You ONLY know about BotForge. Stay on topic. Be helpful, warm, and concise.`;

// POST /api/support/chat - Support bot streaming endpoint (no auth required)
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Build conversation context (last 10 messages)
    const recentHistory = (history || []).slice(-10).map(m => ({
      role: m.role,
      content: m.content
    }));

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
      const demoText = `Hi! I'm BotForge's support assistant. I'm currently in demo mode. Once the OpenAI API key is connected, I can answer all your questions about our platform!`;
      for (const char of demoText) {
        res.write(`data: ${JSON.stringify({ content: char })}\n\n`);
        await new Promise(r => setTimeout(r, 15));
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    try {
      const stream = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: SUPPORT_SYSTEM_PROMPT },
          ...recentHistory,
          { role: 'user', content: message }
        ],
        model: 'gpt-3.5-turbo',
        max_tokens: 400,
        temperature: 0.7,
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
    } catch (aiError) {
      console.error('Support bot AI error:', aiError.message);
      const errMsg = `I'm having trouble connecting right now. Please email us at princekumargiri50@gmail.com for help!`;
      res.write(`data: ${JSON.stringify({ content: errMsg })}\n\n`);
      res.write(`data: [DONE]\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('Support chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error.' });
    } else {
      res.end();
    }
  }
});

module.exports = router;
