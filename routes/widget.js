const express = require('express');
const fs = require('fs');
const path = require('path');
const botStyles = require('../config/botStyles');

const router = express.Router();

// Read the exact same CSS used by the native BotForge ChatWidget
let cssCache = '';
try {
  cssCache = fs.readFileSync(path.join(__dirname, '../config/ChatWidget.css'), 'utf8');
} catch (err) {
  console.error('[BotForge] Warning: Could not read ChatWidget.css:', err.message);
}

// GET /widget.js?bot=ember&token=abc123
router.get('/', (req, res) => {
  const { bot: botId, token } = req.query;

  if (!botId) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.send('console.error("[BotForge] Missing bot parameter.");');
  }

  const bot = botStyles.find(b => b.id === botId);
  if (!bot) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.send('console.error("[BotForge] Bot not found.");');
  }

  if (!token) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.send('console.error("[BotForge] Missing token parameter.");');
  }

  const protocol = req.protocol;
  const host = req.get('host');
  const API_BASE = protocol + '://' + host + '/api/chat/widget-stream';

  // Same welcome messages as ChatWidget.jsx
  const welcomes = {
    nebula: "\u2728 Greetings, seeker of knowledge. I am Nebula \u2014 a guide through the cosmos of thought. What philosophical depths shall we explore today?",
    ember: "\uD83D\uDD25 Hey there, champion! I\u2019m Ember \u2014 your personal hype machine and motivation engine! Ready to set some goals on FIRE? Let\u2019s GO! \uD83D\uDCAA",
    frost: "\u2744\uFE0F Hello. I am Frost \u2014 your analytical companion.\n\n**Specializations:**\n\u2022 Complex problem analysis\n\u2022 Data-driven insights\n\u2022 Structured reasoning\n\nPresent your query, and I\u2019ll dissect it methodically.",
    neon: "```\n> SYSTEM BOOT COMPLETE\n> NEON_BOT v3.1.7 initialized\n> STATUS: ONLINE\n```\nReady to hack the mainframe of knowledge. Drop your query and let\u2019s jack in. \uD83D\uDFE2",
    aurora: "\uD83C\uDF38 Hi there, beautiful soul! I\u2019m Aurora \u2014 your warm companion. \u2728\n\nI\u2019m here to listen, support, and help you bloom. Whatever\u2019s on your mind \u2014 I\u2019m all ears and all heart. \uD83D\uDC97",
    midnight: "\uD83C\uDF19 Good evening.\n\nI am **Midnight** \u2014 your executive AI assistant. I provide refined, professional counsel for:\n\n\u2022 Business strategy\n\u2022 Professional communication\n\u2022 Strategic planning\n\nHow may I assist you today?"
  };

  const welcome = welcomes[botId] || ("Hello! I'm " + bot.name + ". Ready to chat.");

  // Exact same position/style mapping as ChatWidget.jsx BOT_STYLES
  const BOT_LAYOUT = {
    nebula: { bubbleClass: 'bubble-nebula', fontStyle: 'nebula-font', position: 'fullscreen' },
    ember: { bubbleClass: 'bubble-ember', fontStyle: 'ember-font', position: 'bottom-right' },
    frost: { bubbleClass: 'bubble-frost', fontStyle: 'frost-font', position: 'sidebar-right' },
    neon: { bubbleClass: 'bubble-neon', fontStyle: 'neon-font', position: 'bottom-left' },
    aurora: { bubbleClass: 'bubble-aurora', fontStyle: 'aurora-font', position: 'center' },
    midnight: { bubbleClass: 'bubble-midnight', fontStyle: 'midnight-font', position: 'top-right' }
  };
  const layout = BOT_LAYOUT[botId] || BOT_LAYOUT.aurora;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');

  // ── Build full CSS that goes INSIDE the shadow DOM ──
  // This includes fonts import, all ChatWidget.css, trigger button, and resets
  const shadowCSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono&family=Georgia&display=swap');

/* ====== FULL RESET INSIDE SHADOW ====== */
:host { all: initial; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ====== TRIGGER BUTTON ====== */
#bf-trigger-btn {
  position: fixed; bottom: 24px; right: 24px;
  width: 60px; height: 60px; border-radius: 50%;
  background: ${bot.theme.gradient}; border: none; cursor: pointer;
  z-index: 2147483646; color: #fff; font-size: 26px;
  box-shadow: 0 6px 24px ${bot.theme.glow}, 0 2px 8px rgba(0,0,0,0.3);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  display: flex; align-items: center; justify-content: center;
  animation: bf-pop 0.5s cubic-bezier(0.16,1,0.3,1);
  font-family: 'Inter', system-ui, sans-serif;
}
#bf-trigger-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 8px 32px ${bot.theme.glow};
}
#bf-trigger-btn.bf-hidden { display: none; }
@keyframes bf-pop { from { transform: scale(0); } to { transform: scale(1); } }

/* ====== OVERRIDE: Make overlay work in shadow DOM ====== */
.chat-widget-overlay {
  display: none !important;
  z-index: 2147483647;
}
.chat-widget-overlay.bf-open {
  display: flex !important;
}
.chat-widget-overlay.pos-sidebar-right.bf-open {
  display: block !important;
}

/* ====== STATUS TEXT COLOR FIX ====== */
.cw-status { color: rgba(255,255,255,0.5) !important; }
.cw-icon-btn { color: rgba(255,255,255,0.5) !important; }
.cw-icon-btn:hover { color: #fff !important; background: rgba(255,255,255,0.05) !important; }

/* ====== Powered-by footer ====== */
.bf-powered {
  text-align: center; padding: 6px 0;
  font-size: 0.7rem; color: rgba(255,255,255,0.25);
  background: rgba(10,10,10,0.9);
  border-top: 1px solid rgba(255,255,255,0.04);
  font-family: 'Inter', system-ui, sans-serif;
  letter-spacing: 0.02em;
}
.bf-powered strong { color: ${bot.theme.primary}; font-weight: 600; }

${cssCache}
`;

  // ── Build the JS ──
  const lines = [];
  lines.push('(function(){');
  lines.push('if(window.__bf_loaded) return;');
  lines.push('window.__bf_loaded = true;');
  lines.push('');
  lines.push('var BOT_ID = ' + JSON.stringify(botId) + ';');
  lines.push('var TOKEN = ' + JSON.stringify(token) + ';');
  lines.push('var API = ' + JSON.stringify(API_BASE) + ';');
  lines.push('var NAME = ' + JSON.stringify(bot.name) + ';');
  lines.push('var PRIMARY = ' + JSON.stringify(bot.theme.primary) + ';');
  lines.push('var SECONDARY = ' + JSON.stringify(bot.theme.secondary) + ';');
  lines.push('var GRADIENT = ' + JSON.stringify(bot.theme.gradient) + ';');
  lines.push('var GLOW = ' + JSON.stringify(bot.theme.glow) + ';');
  lines.push('var BG = ' + JSON.stringify(bot.theme.bg) + ';');
  lines.push('var POS_CLASS = ' + JSON.stringify('pos-' + layout.position) + ';');
  lines.push('var BUBBLE_CLASS = ' + JSON.stringify(layout.bubbleClass) + ';');
  lines.push('var FONT_CLASS = ' + JSON.stringify(layout.fontStyle) + ';');
  lines.push('var WELCOME = ' + JSON.stringify(welcome) + ';');
  lines.push('');
  lines.push('function initWidget() {');

  // ── Create host element + Shadow DOM ──
  lines.push('  var host = document.createElement("div");');
  lines.push('  host.id = "bf-widget-host";');
  lines.push('  host.style.cssText = "all:initial; position:fixed; top:0; left:0; width:0; height:0; z-index:2147483646; pointer-events:none;";');
  lines.push('  document.body.appendChild(host);');
  lines.push('  var shadow = host.attachShadow({ mode: "open" });');
  lines.push('');

  // ── Inject CSS into Shadow DOM ──
  lines.push('  var style = document.createElement("style");');
  lines.push('  style.textContent = ' + JSON.stringify(shadowCSS) + ';');
  lines.push('  shadow.appendChild(style);');
  lines.push('');

  // ── Wrapper inside shadow ──
  lines.push('  var wrapper = document.createElement("div");');
  lines.push('  wrapper.style.cssText = "all:initial; font-family:Inter,system-ui,-apple-system,sans-serif;";');
  lines.push('  shadow.appendChild(wrapper);');
  lines.push('');

  // ── Build the trigger button ──
  const triggerSVG = '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  lines.push('  var triggerBtn = document.createElement("button");');
  lines.push('  triggerBtn.id = "bf-trigger-btn";');
  lines.push('  triggerBtn.innerHTML = ' + JSON.stringify(triggerSVG) + ';');
  lines.push('  triggerBtn.style.pointerEvents = "auto";');
  lines.push('  wrapper.appendChild(triggerBtn);');
  lines.push('');

  // ── Build overlay + widget HTML ──
  const posClass = 'pos-' + layout.position;
  // Sparkle SVG icon to match Lucide <Sparkles>
  const sparklesSVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>';
  const sparklesAvatarSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>';
  // Trash SVG
  const trashSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
  // X (close) SVG
  const closeSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  // Send SVG
  const sendSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

  const overlayHTML = '<div id="bf-overlay" class="chat-widget-overlay ' + posClass + '">'
    + '<div id="bf-widget" class="chat-widget anim-' + layout.position + ' ' + posClass + '" '
    + 'style="--cw-primary:' + bot.theme.primary + '; --cw-secondary:' + bot.theme.secondary + '; --cw-gradient:' + bot.theme.gradient + '; --cw-glow:' + bot.theme.glow + '; --cw-bg:' + bot.theme.bg + '">'
    + '<div class="cw-glow-top"></div>'
    + '<div class="cw-header">'
    + '<div class="cw-header-left">'
    + '<div class="cw-avatar" style="background:' + bot.theme.gradient + '">' + sparklesAvatarSVG + '</div>'
    + '<div>'
    + '<h3 class="cw-name">' + bot.name + '</h3>'
    + '<span class="cw-status"><span class="cw-status-dot" style="background:' + bot.theme.primary + '"></span><span id="bf-status-text">Online</span></span>'
    + '</div>'
    + '</div>'
    + '<div class="cw-header-right">'
    + '<button class="cw-icon-btn" id="bf-clear" title="Clear history">' + trashSVG + '</button>'
    + '<button class="cw-icon-btn" id="bf-close">' + closeSVG + '</button>'
    + '</div>'
    + '</div>'
    + '<div id="bf-msgs" class="cw-messages"></div>'
    + '<div class="cw-input-area">'
    + '<input id="bf-in" placeholder="Message ' + bot.name + '..." style="--cw-focus-color:' + bot.theme.primary + '" />'
    + '<button id="bf-send">' + sendSVG + '</button>'
    + '</div>'
    + '<div class="bf-powered">Powered by <strong>BotForge</strong></div>'
    + '</div></div>';

  lines.push('  var overlayContainer = document.createElement("div");');
  lines.push('  overlayContainer.innerHTML = ' + JSON.stringify(overlayHTML) + ';');
  lines.push('  wrapper.appendChild(overlayContainer.firstChild);');
  lines.push('');

  // ── Get references from shadow DOM ──
  lines.push('  var trigger = shadow.querySelector("#bf-trigger-btn");');
  lines.push('  var overlay = shadow.querySelector("#bf-overlay");');
  lines.push('  var widget = shadow.querySelector("#bf-widget");');
  lines.push('  var closeBtn = shadow.querySelector("#bf-close");');
  lines.push('  var clearBtn = shadow.querySelector("#bf-clear");');
  lines.push('  var sendBtn = shadow.querySelector("#bf-send");');
  lines.push('  var inputEl = shadow.querySelector("#bf-in");');
  lines.push('  var msgsEl = shadow.querySelector("#bf-msgs");');
  lines.push('  var statusText = shadow.querySelector("#bf-status-text");');
  lines.push('  var sending = false;');
  lines.push('  var chatHistory = [];');
  lines.push('');
  lines.push('  addMsg(WELCOME, "assistant");');
  lines.push('');

  // ── formatContent — identical to ChatWidget.jsx ──
  lines.push('  function formatContent(text) {');
  lines.push('    if (!text) return "";');
  lines.push('    var codeRegex = new RegExp(String.fromCharCode(96)+"{3}([\\\\s\\\\S]*?)"+String.fromCharCode(96)+"{3}", "g");');
  lines.push('    return text');
  lines.push('      .replace(codeRegex, \'<pre class="msg-code">$1</pre>\')');
  lines.push("      .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')");
  lines.push("      .replace(/\\*(.*?)\\*/g, '<em>$1</em>')");
  lines.push("      .replace(/\\u2022 /g, '<span class=\"msg-bullet\">\\u2022 </span>')");
  lines.push("      .replace(/\\n/g, '<br/>');");
  lines.push('  }');
  lines.push('');

  // ── Open widget ──
  lines.push('  trigger.onclick = function() {');
  lines.push('    trigger.classList.add("bf-hidden");');
  lines.push('    overlay.style.pointerEvents = "auto";');
  lines.push('    overlay.className = "chat-widget-overlay " + POS_CLASS + " bf-open opening";');
  lines.push('    widget.className = "chat-widget anim-" + POS_CLASS.replace("pos-","") + " " + POS_CLASS + " bf-open opening";');
  lines.push('    setTimeout(function() {');
  lines.push('      overlay.className = "chat-widget-overlay " + POS_CLASS + " bf-open open";');
  lines.push('      widget.className = "chat-widget anim-" + POS_CLASS.replace("pos-","") + " " + POS_CLASS + " bf-open open";');
  lines.push('      inputEl.focus();');
  lines.push('    }, 700);');
  lines.push('  };');
  lines.push('');

  // ── Close widget ──
  lines.push('  function closeWidget() {');
  lines.push('    overlay.className = "chat-widget-overlay " + POS_CLASS + " bf-open closing";');
  lines.push('    widget.className = "chat-widget anim-" + POS_CLASS.replace("pos-","") + " " + POS_CLASS + " bf-open closing";');
  lines.push('    setTimeout(function() {');
  lines.push('      overlay.className = "chat-widget-overlay " + POS_CLASS;');
  lines.push('      overlay.style.pointerEvents = "none";');
  lines.push('      trigger.classList.remove("bf-hidden");');
  lines.push('    }, 500);');
  lines.push('  }');
  lines.push('  closeBtn.onclick = closeWidget;');
  lines.push('  overlay.onclick = function(e) { if(e.target === overlay) closeWidget(); };');
  lines.push('');

  // ── Stop propagation on widget click ──
  lines.push('  widget.onclick = function(e) { e.stopPropagation(); };');
  lines.push('');

  // ── Clear chat ──
  lines.push('  clearBtn.onclick = function() {');
  lines.push('    chatHistory = [];');
  lines.push('    msgsEl.innerHTML = "";');
  lines.push('    addMsg(WELCOME, "assistant");');
  lines.push('  };');
  lines.push('');

  // ── Input handling ──
  lines.push('  inputEl.onkeydown = function(e) { if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); doSend(); } };');
  lines.push('  sendBtn.onclick = doSend;');
  lines.push('');

  // ── addMsg function (matches ChatWidget.jsx) ──
  lines.push('  function addMsg(text, role) {');
  lines.push('    var d = document.createElement("div");');
  lines.push('    d.className = "cw-msg " + role;');
  lines.push('    var avatarHTML = role === "assistant"');
  lines.push('      ? \'<div class="cw-msg-avatar" style="background:\' + GRADIENT + \'">' + sparklesSVG.replace(/'/g, "\\'") + '</div>\'');
  lines.push('      : "";');
  lines.push('    var bubCls = "cw-bubble " + role + (role === "assistant" ? " " + BUBBLE_CLASS : "");');
  lines.push('    var inner = role === "assistant"');
  lines.push('      ? \'<div class="\' + FONT_CLASS + \'">\' + formatContent(text) + "</div>"');
  lines.push('      : "<p>" + text.replace(/</g,"&lt;").replace(/>/g,"&gt;") + "</p>";');
  lines.push('    d.innerHTML = avatarHTML + \'<div class="\' + bubCls + \'">\' + inner + "</div>";');
  lines.push('    msgsEl.appendChild(d);');
  lines.push('    msgsEl.scrollTop = msgsEl.scrollHeight;');
  lines.push('    chatHistory.push({ role: role, content: text });');
  lines.push('    return d;');
  lines.push('  }');
  lines.push('');

  // ── doSend with streaming (matches ChatWidget.jsx) ──
  lines.push('  function doSend() {');
  lines.push('    if(sending) return;');
  lines.push('    var msg = inputEl.value.trim();');
  lines.push('    if(!msg) return;');
  lines.push('    inputEl.value = "";');
  lines.push('    addMsg(msg, "user");');
  lines.push('');
  lines.push('    // Update send button gradient');
  lines.push('    sendBtn.style.background = "";');
  lines.push('');
  lines.push('    // Create streaming message row');
  lines.push('    var row = document.createElement("div");');
  lines.push('    row.className = "cw-msg assistant";');
  lines.push('    row.innerHTML = \'<div class="cw-msg-avatar" style="background:\' + GRADIENT + \'">' + sparklesSVG.replace(/'/g, "\\'") + '</div>\'');
  lines.push('      + \'<div class="cw-bubble assistant \' + BUBBLE_CLASS + \' streaming"><div class="\' + FONT_CLASS + \'"></div></div>\';');
  lines.push('    msgsEl.appendChild(row);');
  lines.push('    msgsEl.scrollTop = msgsEl.scrollHeight;');
  lines.push('    var contentEl = row.querySelector("." + FONT_CLASS);');
  lines.push('');
  lines.push('    // Show thinking state');
  lines.push('    contentEl.innerHTML = \'<div class="cw-thinking"><span class="thinking-label" style="color:\' + PRIMARY + \'">\' + NAME + \' is thinking</span><div class="cw-typing"><span style="background:\' + PRIMARY + \'"></span><span style="background:\' + PRIMARY + \'"></span><span style="background:\' + PRIMARY + \'"></span></div></div>\';');
  lines.push('');
  lines.push('    sending = true;');
  lines.push('    sendBtn.disabled = true;');
  lines.push('    statusText.textContent = "Thinking...";');
  lines.push('');
  lines.push('    fetch(API, {');
  lines.push('      method: "POST",');
  lines.push('      headers: { "Content-Type": "application/json" },');
  lines.push('      body: JSON.stringify({ message: msg, botStyleId: BOT_ID, widgetToken: TOKEN })');
  lines.push('    }).then(function(res) {');
  lines.push('      var reader = res.body.getReader();');
  lines.push('      var decoder = new TextDecoder();');
  lines.push('      var full = "";');
  lines.push('      var started = false;');
  lines.push('      function pump() {');
  lines.push('        return reader.read().then(function(result) {');
  lines.push('          if(result.done) {');
  lines.push('            sending=false; sendBtn.disabled=false; statusText.textContent="Online";');
  lines.push('            row.querySelector(".cw-bubble").classList.remove("streaming");');
  lines.push('            if(full) chatHistory.push({ role: "assistant", content: full });');
  lines.push('            return;');
  lines.push('          }');
  lines.push('          var chunk = decoder.decode(result.value, {stream:true});');
  lines.push('          var chunkLines = chunk.split("\\n");');
  lines.push('          for(var i=0; i<chunkLines.length; i++) {');
  lines.push('            if(!chunkLines[i].startsWith("data: ")) continue;');
  lines.push('            var data = chunkLines[i].slice(6);');
  lines.push('            if(data === "[DONE]") continue;');
  lines.push('            try {');
  lines.push('              var p = JSON.parse(data);');
  lines.push('              if(p.content) {');
  lines.push('                if(!started) { started = true; }');
  lines.push('                full += p.content;');
  lines.push('                contentEl.innerHTML = formatContent(full) + \'<span class="stream-cursor" style="background:\' + PRIMARY + \'"></span>\';');
  lines.push('              }');
  lines.push('            } catch(e) {}');
  lines.push('          }');
  lines.push('          msgsEl.scrollTop = msgsEl.scrollHeight;');
  lines.push('          return pump();');
  lines.push('        });');
  lines.push('      }');
  lines.push('      return pump();');
  lines.push('    }).catch(function(err) {');
  lines.push('      contentEl.innerHTML = "Connection error. Please try again.";');
  lines.push('      sending=false; sendBtn.disabled=false; statusText.textContent="Online";');
  lines.push('    });');
  lines.push('  }');

  lines.push('');
  lines.push('  // Update send button style');
  lines.push('  inputEl.oninput = function() {');
  lines.push('    if(inputEl.value.trim() && !sending) {');
  lines.push('      sendBtn.style.background = GRADIENT;');
  lines.push('      sendBtn.style.color = "#fff";');
  lines.push('      sendBtn.style.boxShadow = "0 0 15px " + GLOW;');
  lines.push('    } else {');
  lines.push('      sendBtn.style.background = "";');
  lines.push('      sendBtn.style.color = "";');
  lines.push('      sendBtn.style.boxShadow = "";');
  lines.push('    }');
  lines.push('  };');

  lines.push('}'); // end initWidget

  lines.push('');
  lines.push('if (document.readyState === "loading") {');
  lines.push('  document.addEventListener("DOMContentLoaded", initWidget);');
  lines.push('} else {');
  lines.push('  initWidget();');
  lines.push('}');
  lines.push('})();');

  res.send(lines.join('\n'));
});

module.exports = router;
