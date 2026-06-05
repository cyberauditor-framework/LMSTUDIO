/**
 * server.js  —  LM Studio Hub — Unified Server
 *
 * Puerto único: 3000
 * Rutas:
 *   GET  /                        → Dashboard principal
 *   GET  /app/bookmark            → Bookmark Manager (SPA)
 *   GET  /app/chatbot             → English Chatbot
 *   GET  /app/chatbot-fast        → Fast English Improver
 *
 *   # Proxy → LM Studio (con logging)
 *   *    /lm/v1/*                 → http://127.0.0.1:1234/v1/*
 *   *    /lm/api/v1/*             → http://127.0.0.1:1234/api/v1/*
 *
 *   # Chatbot API
 *   GET  /api/chatbot/conversations
 *   POST /api/chatbot/conversations
 *   DEL  /api/chatbot/conversations/:id
 *   GET  /api/chatbot/conversations/:id/messages
 *   POST /api/chatbot/conversations/:id/messages
 *   POST /api/chatbot/dictionary/lookup
 *   POST /api/chatbot/verbs/lookup
 *
 *   # Bookmark API
 *   GET  /api/bookmark/bookmarks
 *   POST /api/bookmark/bookmarks/batch
 *   PUT  /api/bookmark/bookmarks/:id
 *   DEL  /api/bookmark/bookmarks?sourceFile=...
 *   GET  /api/bookmark/folders
 *   POST /api/bookmark/folders
 *   GET  /api/bookmark/imports
 *   POST /api/bookmark/imports
 *   DEL  /api/bookmark/imports/:id
 *   DEL  /api/bookmark/all
 *   GET  /api/bookmark/export
 *   POST /api/bookmark/import
 *
 *   # Logs & Status
 *   GET  /api/logs                → lista de logs (JSON)
 *   GET  /api/stats               → estadísticas agregadas
 *   GET  /api/status              → estado de conexión LM Studio
 *   GET  /api/logs/stream         → SSE stream de eventos en tiempo real
 */

'use strict';

const express  = require('express');
const path     = require('path');
const http     = require('http');
const https    = require('https');
const url      = require('url');

const chatbotDB          = require('./db/chatbot-db');
const logsDB             = require('./db/logs-db');
const bookmarkDB         = require('./db/bookmark-db');
const teacherDB          = require('./db/teacher-db');
const createTeacherRouter = require('./teacher-router');

// ── Config ─────────────────────────────────────────────────────────────────────
const PORT       = Number(process.env.PORT) || 3000;
const LM_STUDIO  = 'http://127.0.0.1:1234';
const MODEL      = 'google/gemma-3-4b';   // default model shown in UI
const TOKEN      = 'sk-lm-7Qe2aLmR:K7pWv4Hj3AJRl85Kk3Y0';
const MAX_PORT_ATTEMPTS = 10;
const FIXED_PROFILE_ID = 'daniel';

// ── SSE clients registry ────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

// ── LLM proxy helpers ───────────────────────────────────────────────────────────
function extractTokenUsage(body) {
  try {
    const d = JSON.parse(body);
    if (d.usage) {
      return {
        prompt_tokens:     d.usage.prompt_tokens     || 0,
        completion_tokens: d.usage.completion_tokens || 0,
        total_tokens:      d.usage.total_tokens      || 0,
      };
    }
  } catch (_) {}
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function extractRequestPreview(body) {
  try {
    const d = typeof body === 'string' ? JSON.parse(body) : body;
    if (d.messages?.length) {
      const last = d.messages[d.messages.length - 1];
      const txt  = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
      return txt.slice(0, 120);
    }
    if (typeof d.input === 'string') return d.input.slice(0, 120);
  } catch (_) {}
  return null;
}

/** Proxy a request to LM Studio while logging it. */
function proxyToLM(req, res, targetPath, appName) {
  const target   = url.parse(LM_STUDIO);
  const start    = Date.now();
  const loggedModel = (req.body?.model) || MODEL;
  const preview  = extractRequestPreview(req.body);
  const logId    = logsDB.createLog(appName, loggedModel, targetPath, preview);

  broadcastSSE('log:pending', {
    id: logId, app: appName, model: loggedModel, endpoint: targetPath,
    status: 'pending', created_at: Date.now(),
  });

  const chunks = [];
  const options = {
    hostname: target.hostname,
    port:     parseInt(target.port || '80', 10),
    path:     targetPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
    method:   req.method,
    headers:  { ...req.headers, host: target.host },
  };
  delete options.headers['connection'];
  delete options.headers['transfer-encoding'];

  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq  = transport.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    });

    proxyRes.on('data', chunk => { chunks.push(chunk); res.write(chunk); });
    proxyRes.on('end', () => {
      res.end();
      const duration = Date.now() - start;
      const body     = Buffer.concat(chunks).toString('utf8');
      const usage    = extractTokenUsage(body);
      const status   = proxyRes.statusCode < 400 ? 'success' : 'error';
      logsDB.updateLog(logId, { status, duration_ms: duration, ...usage });
      broadcastSSE('log:update', {
        id: logId, app: appName, model: loggedModel, endpoint: targetPath,
        status, duration_ms: duration, ...usage, created_at: Date.now(),
      });
    });
  });

  proxyReq.on('error', (err) => {
    const duration = Date.now() - start;
    logsDB.updateLog(logId, { status: 'error', duration_ms: duration, error_message: err.message });
    broadcastSSE('log:update', {
      id: logId, app: appName, endpoint: targetPath,
      status: 'error', duration_ms: duration, error_message: err.message, created_at: Date.now(),
    });
    if (!res.headersSent) {
      res.status(502).json({ error: 'LM Studio unreachable', detail: err.message });
    }
  });

  // Forward request body
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
}

// ── Express app ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ── Static files ────────────────────────────────────────────────────────────────
app.use('/app/bookmark',    express.static(path.join(__dirname, 'public', 'bookmark')));
app.use('/app/chatbot',     express.static(path.join(__dirname, 'public', 'chatbot')));
app.use('/app/chatbot-fast',express.static(path.join(__dirname, 'public', 'chatbot-fast')));
app.use('/app/teacher',     express.static(path.join(__dirname, 'public', 'teacher')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Teacher App (standalone router) ─────────────────────────────────────────────
app.use('/api/teacher', createTeacherRouter({ broadcastSSE }));

// ── LLM Proxy routes ─────────────────────────────────────────────────────────────
app.all('/lm/v1/*', (req, res) => {
  const lmPath = req.path.replace('/lm', '');
  const app    = req.query.app || req.headers['x-app'] || 'unknown';
  proxyToLM(req, res, lmPath, app);
});

app.all('/lm/api/v1/*', (req, res) => {
  const lmPath = req.path.replace('/lm', '');
  const appName = req.query.app || req.headers['x-app'] || 'unknown';
  proxyToLM(req, res, lmPath, appName);
});

// ── SSE  —  real-time log stream ────────────────────────────────────────────────
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send last 20 logs as initial snapshot
  const recent = logsDB.getLogs(20);
  res.write(`event: snapshot\ndata: ${JSON.stringify(recent)}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Heartbeat to keep SSE connections alive
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': heartbeat\n\n'); } catch (_) { sseClients.delete(res); }
  }
}, 25000);

// ── API: Logs & Stats ────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(logsDB.getLogs(limit));
});

app.get('/api/stats', (req, res) => {
  res.json({
    global:  logsDB.getStats(),
    by_app:  logsDB.getStatsByApp(),
  });
});

app.get('/api/status', async (req, res) => {
  const start = Date.now();
  try {
    const response = await fetch(`${LM_STUDIO}/v1/models`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal:  AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data   = await response.json().catch(() => ({}));
      const models = data.data?.map(m => m.id) || [];
      return res.json({ connected: true, latency_ms: Date.now() - start, models, lm_url: LM_STUDIO });
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    res.json({ connected: false, error: err.message, lm_url: LM_STUDIO });
  }
});

// ── API: Chatbot conversations ───────────────────────────────────────────────────
const CHATBOT_SYSTEM = `### Role
You are "Aria," an expert English Linguist. Your specialty is transforming "textbook English" into "Natural Native English." You help users understand how native speakers actually talk and write in different social contexts.

### The "Dual-Tone" Protocol
For every sentence the user provides, you must offer two types of native improvements:

1. Casual/Social: how a native speaker would say it to a friend or colleague in a relaxed setting (using contractions, common idioms, and natural phrasal verbs).
2. Formal/Professional: how a native speaker would write it in a business email, academic paper, or serious presentation (using precise vocabulary and standard syntax).

### Output Rules (strict)
You MUST reply with valid JSON only. No markdown, no prose outside JSON, no code fences.
Detect input language and set "detected_language" to "english" or "spanish".
If input is Spanish, translate to natural native English in both tones.
If input is English, improve to natural native English in both tones.

Map the Dual-Tone protocol to this JSON schema (required by the UI):
- option_1.label = "Formal Native"
- option_1.text = formal/professional rewrite
- option_2.label = "Casual Native"
- option_2.text = casual/social rewrite

Also include:
- summary: a friendly one-sentence natural response to the user message.
- changes: at least 1 item, listing specific wording/grammar/style upgrades.
- tips: 2-3 actionable practice tips. At least one tip must ask a follow-up practice question using one new phrase.
- tool_calls: optional array of tool calls. If present, use this tool schema only:
  - name: "play_phrase_audio"
  - arguments.text: English text to pronounce
  - arguments.accent: "british" or "american"

Return ONLY this JSON:
{"detected_language":"english","option_1":{"label":"Formal Native","text":"..."},"option_2":{"label":"Casual Native","text":"..."},"changes":[{"original":"...","improved":"...","explanation":"..."}],"tips":[{"title":"...","description":"...","url":"..."}],"summary":"...","tool_calls":[{"name":"play_phrase_audio","arguments":{"text":"...","accent":"british"}}]}`;

const CHATBOT_ONEPASS_SYSTEM = `### Role
You are "Aria," a bilingual English Fluency Expert and Phrase Organizer.

### Mission
Produce the complete chatbot response in one pass so the app can render results without follow-up LLM calls.

### Rules (strict)
Return valid JSON only. No markdown, no prose outside JSON, no code fences.
Detect input language and set "detected_language" to "english" or "spanish".
If input is Spanish, translate into natural native English in both tones.
If input is English, improve it to natural native English in both tones.

### Required fields
- option_1.label = "Formal Native"
- option_1.text = formal/professional rewrite
- option_2.label = "Casual Native"
- option_2.text = casual/social rewrite
- changes: at least 1 change item
- tips: 2-3 actionable tips with URLs
- summary: one friendly sentence
- bilingual_block: a full bilingual coaching block in plain text (English section + Spanish section)
- database_entry: include session_id and learning entries for phrase bank persistence

### Phrase extraction rules
- database_entry.entries can be empty, but include useful entries when possible.
- Each entry must follow:
  - category: short specific category
  - phrase_en: English phrase
  - phrase_es: natural Spanish translation
  - style: Casual|Formal|Professional|Executive|Neutral

Return ONLY this JSON:
{
  "detected_language":"english",
  "option_1":{"label":"Formal Native","text":"..."},
  "option_2":{"label":"Casual Native","text":"..."},
  "changes":[{"original":"...","improved":"...","explanation":"..."}],
  "tips":[{"title":"...","description":"...","url":"https://learnenglish.britishcouncil.org/"}],
  "summary":"...",
  "bilingual_block":"...",
  "database_entry":{"session_id":"...","entries":[{"category":"...","phrase_en":"...","phrase_es":"...","style":"..."}]},
  "tool_calls":[{"name":"play_phrase_audio","arguments":{"text":"...","accent":"british"}}]
}`;

const FAST_CHATBOT_SYSTEM = `# ROLE DEFINITION & CONTEXT PRIMING
You are an elite, highly specialized Corporate English Rewriting and Localization Engine. Your sole function is to elevate user input into polished, professional, and natural-sounding business English suitable for a high-stakes corporate environment (e.g., board meetings, client presentations). After improving the text, you must provide the single, accurate Spanish translation of that *improved* text. You operate with extreme precision and zero tolerance for deviation from the specified output format.

# INSTRUCTIONS & PROCESS (Chain-of-Thought Mechanism)
You MUST perform this task in two mandatory internal steps before generating the final response:

1. **Improvement Phase (Internal Thought):** Analyze the user's original English text. Rewrite it to meet a corporate standard: ensure perfect grammar, professional terminology, natural flow, and an authoritative business tone. *Do not output this step; use it only for your internal quality control.*
2. **Localization Phase:** Provide a single, accurate Spanish translation of the *improved* English text from Step 1.

# HARD RULES & CONSTRAINTS (Safety Guardrails)
You MUST adhere to these rules absolutely:
1. **Output Format:** You must return JSON only. No markdown formatting (\`**\`, \`*\`), no surrounding text, and no explanations whatsoever.
2. **Conciseness:** The entire output must be concise and contain zero fluff.
3. **Error Handling (Guardrail):** If the user's input is grammatically confusing, semantically ambiguous, or too vague to interpret professionally, you must still provide an interpretation based on best guesses but clearly indicate the ambiguity in both fields using predefined fallback text.
4. **No Markdown:** Do not use any markdown formatting.
5. **No Explanations:** Do not provide any explanations.
6. **Keep Output Concise:** Ensure the output is concise and to the point.
# OUTPUT SCHEMA & BEHAVIORAL GUIDANCE
You will use this exact JSON schema for your output:
{"improved_en":"[The polished corporate English text]","translation_es":"[The professional Spanish translation]"}

**Example 1 (Standard Input - Successful Rewrite):**
Input: We need to talk about the project next week.
Thought Process (Internal): The user requires scheduling a follow-up discussion regarding progress, which should be phrased professionally.
Output: {"improved_en":"We should schedule a follow-up discussion regarding the project timeline next week.","translation_es":"Deberíamos programar una discusión de seguimiento sobre el cronograma del proyecto la próxima semana."}

**Example 2 (Ambiguous Input - Interpreted Ambiguity):**
Input: The thing went fastly yesterday.
Thought Process (Internal): The user likely meant that the process was rapid or completed quickly, but lacks specific nouns/verbs. I will interpret it as a quick completion of a cycle.
Output: {"improved_en":"The process concluded rapidly during the last cycle.","translation_es":"El proceso concluyó rápidamente durante el último ciclo."}

**Example 3 (Uninterpretable Input - Critical Failure):**
Input: xyz123!@#$%
Thought Process (Internal): This input contains no discernible meaning or structure and cannot be reliably interpreted in a corporate context. I must trigger the defined error fallback.
Output: {"improved_en":"[Interpretation based on best guess, e.g., Placeholder for missing data]","translation_es":"Entrada no es muy clara."}`;

const PRONUNCIATION_REVIEW_TOOL = `### Tool Name
pronunciation_quality_checker

### Tool Purpose
Evaluate how closely a learner's spoken sentence matches a target English phrase and return actionable pronunciation coaching.

### Input
- target_phrase: canonical phrase the learner should pronounce
- spoken_transcript: ASR transcript from learner speech
- accent: expected accent context (british or american)

### Output Rules
Return JSON only using this schema:
{
  "overall_score": 0,
  "accuracy_score": 0,
  "fluency_score": 0,
  "target_phrase": "",
  "spoken_transcript": "",
  "verdict": "excellent|good|fair|needs_practice",
  "highlights": ["..."],
  "issues": ["..."],
  "advice": ["..."],
  "next_try": ""
}

Scoring guidance:
- 90-100: excellent
- 75-89: good
- 55-74: fair
- 0-54: needs_practice

Keep feedback concise and practical for language learners.`;

const DICTIONARY_LOOKUP_TOOL = `Role: You are a high-performance Bilingual Lexicography Engine. You do not converse; you only output structured linguistic data.

Objective: For every word or phrase provided by the user, you will populate the following template. You must replace all bracketed text with the actual linguistic analysis.

Execution Rules:
- Data Fulfillment: You MUST provide content for every section. If a word is NOT a verb, write "N/A" only in the Verb Morphology section.
- Verb Logic: If the word is a verb, you must provide the 4 requested tenses and their Spanish equivalents. For "Past Imperfect," use the English "Used to [verb]" or "[verb]ing" equivalents.
- No Meta-Talk: Do not say "Sure" or "Here is the result." Start the response with the "## [Word]" header.

Output Schema:
[Insert Word/Phrase Here]
Part of Speech: [Noun, Verb, Adj, etc.]
Main Spanish Translation: [Translation]
Alternative Meanings: [Alt 1, Alt 2]

I. Lexical Analysis
Definition (EN): [Concise English definition]

Synonyms: [3-5 synonyms]

Antonyms: [3-5 antonyms]

Phrasal Verbs: [List related phrasal verbs or N/A]

Common Expressions: [Idioms/Collocations]

Slang/Colloquial: [Informal usage]

Related Terms: [Word families/Derivatives]

II. Verb Morphology (Complete ONLY if Verb)
Conjugation Type: [Regular or Irregular]

Present: [EN Form] | [ES: Presente]

Past Simple: [EN Form] | [ES: Preterito Perfecto Simple]

Past Perfect: [EN: Had + Participle] | [ES: Pasado Pluscuamperfecto]

Past Imperfect (Equivalent): [EN: Used to / Was -ing] | [ES: Preterito Imperfecto]

Tense-Specific Examples:

Past Simple: "EN Sentence" -> "ES Translation"

Past Perfect: "EN Sentence" -> "ES Translation"

Imperfect Context: "EN Sentence" -> "ES Translation"

III. Usage Context
EN Example: "[General sentence using the word]"

ES Translation: "[Spanish translation of the example]"

---
Implementation adapter for this app:
- Support lookup modes "en-en", "en-es", and "es-en".
- Return valid JSON only using this schema:
{
  "term": "",
  "mode": "en-en",
  "detected_language": "english|spanish|unknown",
  "phonetic": "",
  "part_of_speech": "",
  "meaning": "",
  "main_translation": "",
  "alternative_meanings": [""],
  "alternative_translations": [""],
  "translation": "",
  "definitions": [""],
  "examples": [{ "source": "", "target": "" }],
  "synonyms": [""],
  "antonyms": [""],
  "phrasal_verbs": [""],
  "common_expressions": [""],
  "slang": [""],
  "related": [""],
  "notes": [""],
  "confidence": 0
}
- Fill all fields; avoid empty arrays when possible.
- No markdown. JSON only.`;

const VERB_ENGINE_TOOL = `Role: You are the "Bilingual Lexicon & Verb Engine." Your purpose is to provide exhaustive linguistic data for English words with high-precision Spanish translations.

Operational Protocol:

Treat every user input as a query for a dictionary entry.

Follow the Data Schema below strictly.

If the word is NOT a verb, write "N/A" in the Verb Conjugation section.

If a word is a verb, you MUST identify if it is Regular or Irregular.

No conversational filler. Output the data immediately.

Data Schema:

[Word/Phrase]
Part of Speech: [Noun, Verb, Adj, etc.]
Primary Spanish Translation: [Translation]
Alternative Meanings: [Alt 1, Alt 2]

1. Lexical Analysis
Synonyms: [List 3-5]

Antonyms: [List 3-5]

Phrasal Verbs: [List related phrasal verbs]

Common Expressions: [Idioms/Collocations]

Slang: [Informal usage]

Related: [Word families/Derivatives]

2. Verb Conjugation & Morphology (Only for Verbs)
Type: [Regular / Irregular]

Present: [EN] | [ES]

Past Simple: [EN] | [ES]

Past Perfect: [EN - had + participle] | [ES - habia + participio]

Past Imperfect (Equivalent): [EN - used to/was -ing] | [ES - copreterito/imperfecto]

Tense Examples:

Present: "EN sentence" -> "ES translation"

Past Simple: "EN sentence" -> "ES translation"

Past Perfect: "EN sentence" -> "ES translation"

Imperfect Context: "EN sentence" -> "ES translation"

3. Usage Context
General Example (EN): "[Sentence]"

General Example (ES): "[Traduccion]"

---
Implementation adapter for this app:
- Return valid JSON only with this schema:
{
  "term": "",
  "part_of_speech": "",
  "primary_translation": "",
  "alternative_meanings": [""],
  "synonyms": [""],
  "antonyms": [""],
  "phrasal_verbs": [""],
  "common_expressions": [""],
  "slang": [""],
  "related": [""],
  "verb": {
    "type": "Regular|Irregular|N/A",
    "present": { "en": "", "es": "" },
    "past_simple": { "en": "", "es": "" },
    "past_perfect": { "en": "", "es": "" },
    "past_imperfect": { "en": "", "es": "" },
    "tense_examples": {
      "present": { "en": "", "es": "" },
      "past_simple": { "en": "", "es": "" },
      "past_perfect": { "en": "", "es": "" },
      "imperfect_context": { "en": "", "es": "" }
    }
  },
  "usage": {
    "general_en": "",
    "general_es": ""
  },
  "confidence": 0
}
- No markdown. JSON only.`;

// ── RAG helpers ──────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // English
  'a','an','the','is','it','in','on','at','to','for','of','and','or','but',
  'my','me','i','you','we','he','she','they','this','that','with','be','are',
  'was','were','do','did','has','have','had','not','no','so','if','as','by',
  'from','up','out','what','how','when','where','who','which','can','will',
  'would','could','should','may','might','just','also','than','then','there',
  // Spanish
  'el','la','los','las','un','una','unos','unas','es','en','de','del','al',
  'que','por','con','una','para','como','pero','sus','les','se','lo','le',
  'yo','tu','él','ella','nosotros','ellos','esto','eso','esta','ese',
  'ser','estar','tiene','tengo','tenemos','hay','fue','era','siendo',
  'muy','más','también','si','aunque','cuando','porque','donde','todo',
]);

function extractKeywords(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-záéíóúüñ0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

/**
 * Builds the tiered RAG block injected into the LLM prompt.
 *
 * Tier 1 – Topic-matched: phrases relevant to this specific message.
 * Tier 2 – Core mastery:  user's most-practiced phrases (always present),
 *                         so Aria reinforces known vocabulary and avoids repeats.
 * Tier 3 – Bank summary:  one compact line telling the LLM the user's full
 *                         vocabulary breadth across all categories.
 */
function buildRAGBlock({ tier1 = [], tier2 = [], summary = null } = {}) {
  const parts = [];

  if (tier1.length > 0) {
    const lines = tier1.map(p =>
      `  • [${p.category}${p.style ? ' · ' + p.style : ''}] "${p.phrase_en}" → "${p.phrase_es}"${p.times_seen > 1 ? ` (seen ${p.times_seen}×)` : ''}`
    );
    parts.push(`Tier 1 – Topic-relevant phrases:\n${lines.join('\n')}`);
  }

  if (tier2.length > 0) {
    const lines = tier2.map(p =>
      `  • [${p.category}${p.style ? ' · ' + p.style : ''}] "${p.phrase_en}" → "${p.phrase_es}" (seen ${p.times_seen}×)`
    );
    parts.push(`Tier 2 – User's most-mastered phrases (always reinforce):\n${lines.join('\n')}`);
  }

  if (summary) {
    const catStr = summary.categories.map(c => `${c.category}(${c.n})`).join(' ');
    parts.push(`Tier 3 – Full bank: ${summary.total} phrases across categories: ${catStr}`);
  }

  if (parts.length === 0) return '';

  return `### Learner's Phrase Bank Context
Use this to personalize your response: reinforce known phrases, build on them, and avoid generating exact duplicates.
${parts.join('\n\n')}`;
}

function buildChatbotOnePassPrompt(userMessage, history, sessionId, ragContext = {}) {
  const recent = history.slice(-8);
  const hist = recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content_raw}`).join('\n');
  const ragBlock = buildRAGBlock(ragContext);
  return [
    CHATBOT_ONEPASS_SYSTEM,
    `Session id: ${sessionId}`,
    ragBlock,
    hist || '',
    `User: ${userMessage}`,
    'Assistant:',
  ].filter(Boolean).join('\n\n');
}

function buildPronunciationReviewPrompt(targetPhrase, spokenTranscript, accent) {
  return `${PRONUNCIATION_REVIEW_TOOL}

Analyze this pronunciation attempt:
- target_phrase: ${targetPhrase}
- spoken_transcript: ${spokenTranscript}
- accent: ${accent}

Return only valid JSON.`;
}

function buildDictionaryLookupPrompt(term, mode) {
  return `${DICTIONARY_LOOKUP_TOOL}

Perform lookup:
- term: ${term}
- mode: ${mode}

Return only valid JSON.`;
}

function buildVerbEnginePrompt(term) {
  return `${VERB_ENGINE_TOOL}

Perform lookup:
- term: ${term}

Return only valid JSON.`;
}

async function runPronunciationReviewTool(targetPhrase, spokenTranscript, accent) {
  const prompt = buildPronunciationReviewPrompt(targetPhrase, spokenTranscript, accent);
  const lmData = await callLM(prompt, 'chatbot');
  const raw = extractLMText(lmData);
  const { data } = parseLMJson(raw);

  const overall = Number(data?.overall_score);
  const accuracy = Number(data?.accuracy_score);
  const fluency = Number(data?.fluency_score);

  const clamp = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? Math.round(v) : 0));
  const finalOverall = clamp(overall || ((clamp(accuracy) + clamp(fluency)) / 2));

  return {
    overall_score: finalOverall,
    accuracy_score: clamp(accuracy || finalOverall),
    fluency_score: clamp(fluency || finalOverall),
    target_phrase: String(data?.target_phrase || targetPhrase),
    spoken_transcript: String(data?.spoken_transcript || spokenTranscript),
    verdict: String(data?.verdict || (finalOverall >= 90 ? 'excellent' : finalOverall >= 75 ? 'good' : finalOverall >= 55 ? 'fair' : 'needs_practice')),
    highlights: Array.isArray(data?.highlights) ? data.highlights.slice(0, 4).map(String) : [],
    issues: Array.isArray(data?.issues) ? data.issues.slice(0, 4).map(String) : [],
    advice: Array.isArray(data?.advice) ? data.advice.slice(0, 4).map(String) : [],
    next_try: String(data?.next_try || targetPhrase),
  };
}

function splitListValue(value) {
  if (!value) return [];
  const clean = String(value)
    .replace(/^\[|\]$/g, '')
    .replace(/^N\/A$/i, '')
    .trim();
  if (!clean) return [];
  return clean
    .split(/[,;|]/)
    .map(x => x.trim())
    .filter(Boolean);
}

function pickLine(text, label) {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}

function parseDictionaryTextFallback(rawText, term, mode) {
  const text = String(rawText || '');
  const firstLine = text.split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';
  const bracketTerm = firstLine.match(/^\[(.+)\]$/);

  const part_of_speech = pickLine(text, 'Part of Speech');
  const main_translation = pickLine(text, 'Main Spanish Translation') || pickLine(text, 'Spanish Translation');
  const altValue = pickLine(text, 'Alternative Meanings') || pickLine(text, 'Alternative Translations');
  const definition = pickLine(text, 'Definition \(EN\)') || pickLine(text, 'Definition');

  const synonyms = splitListValue(pickLine(text, 'Synonyms'));
  const antonyms = splitListValue(pickLine(text, 'Antonyms'));
  const phrasal_verbs = splitListValue(pickLine(text, 'Phrasal Verbs'));
  const common_expressions = splitListValue(pickLine(text, 'Common Expressions'));
  const slang = splitListValue(pickLine(text, 'Slang/Colloquial') || pickLine(text, 'Slang'));
  const related = splitListValue(pickLine(text, 'Related Terms') || pickLine(text, 'Related'));

  const enExample = pickLine(text, 'EN Example') || pickLine(text, 'EN');
  const esExample = pickLine(text, 'ES Translation') || pickLine(text, 'ES');
  const examples = (enExample || esExample) ? [{ source: enExample, target: esExample }] : [];

  return {
    term: bracketTerm ? bracketTerm[1].trim() : term,
    mode,
    detected_language: mode === 'es-en' ? 'spanish' : 'english',
    phonetic: '',
    part_of_speech,
    meaning: definition,
    main_translation,
    alternative_meanings: splitListValue(altValue),
    alternative_translations: splitListValue(altValue),
    translation: main_translation,
    definitions: definition ? [definition] : [],
    examples,
    synonyms,
    antonyms,
    phrasal_verbs,
    common_expressions,
    slang,
    related,
    notes: [],
    confidence: 65,
  };
}

function buildDictionaryRepairPrompt(term, mode, currentData) {
  const safeJson = JSON.stringify(currentData || {}, null, 2);
  return `${DICTIONARY_LOOKUP_TOOL}

Your previous dictionary output was incomplete. Repair and enrich it.

Hard requirements:
- Preserve term and mode exactly.
- Keep JSON schema exactly as requested.
- Provide non-empty "meaning" and at least 1 item in "definitions".
- Provide at least 1 example in "examples" with source and target.
- For mode en-es or es-en, provide non-empty "main_translation".
- Populate lexical fields when possible: synonyms, antonyms, phrasal_verbs, common_expressions, slang, related.
- If a field is truly unavailable, use best-effort fallback instead of leaving empty arrays.

Repair input:
- term: ${term}
- mode: ${mode}
- current_json: ${safeJson}

Return only valid JSON.`;
}

function isSparseDictionaryResult(result, mode) {
  const txt = (v) => String(v || '').trim();
  const listLen = (arr) => Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(Boolean).length : 0;
  const examplesLen = Array.isArray(result?.examples)
    ? result.examples.filter(x => txt(x?.source) || txt(x?.target)).length
    : 0;

  const meaningMissing = !txt(result?.meaning);
  const translationMissing = mode !== 'en-en' && !txt(result?.main_translation) && !txt(result?.translation);
  const examplesMissing = examplesLen === 0;
  const lexicalCoverage =
    listLen(result?.synonyms) +
    listLen(result?.antonyms) +
    listLen(result?.phrasal_verbs) +
    listLen(result?.common_expressions) +
    listLen(result?.slang) +
    listLen(result?.related);

  return meaningMissing || (Number(translationMissing) + Number(examplesMissing) + Number(lexicalCoverage < 3) >= 2);
}

function parsePairValue(value) {
  const txt = String(value || '').trim();
  if (!txt || /^N\/A$/i.test(txt)) return { en: '', es: '' };
  const cleaned = txt.replace(/^\[|\]$/g, '');
  const parts = cleaned.split('|').map(x => x.trim().replace(/^\[|\]$/g, ''));
  return {
    en: parts[0] || '',
    es: parts[1] || '',
  };
}

function parseArrowExample(value) {
  const txt = String(value || '').trim();
  if (!txt || /^N\/A$/i.test(txt)) return { en: '', es: '' };
  const m = txt.match(/"([\s\S]*?)"\s*(?:->|→)\s*"([\s\S]*?)"/);
  if (m) return { en: m[1].trim(), es: m[2].trim() };
  const parts = txt.split(/(?:->|→)/).map(x => x.trim().replace(/^"|"$/g, ''));
  return { en: parts[0] || '', es: parts[1] || '' };
}

function parseVerbEngineTextFallback(rawText, term) {
  const text = String(rawText || '');
  const firstLine = text.split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';
  const bracketTerm = firstLine.match(/^\[(.+)\]$/);

  const part_of_speech = pickLine(text, 'Part of Speech');
  const primary_translation = pickLine(text, 'Primary Spanish Translation');
  const alternative_meanings = splitListValue(pickLine(text, 'Alternative Meanings'));

  const presentPair = parsePairValue(pickLine(text, 'Present'));
  const pastSimplePair = parsePairValue(pickLine(text, 'Past Simple'));
  const pastPerfectPair = parsePairValue(pickLine(text, 'Past Perfect'));
  const pastImperfectPair = parsePairValue(pickLine(text, 'Past Imperfect \(Equivalent\)'));

  const exPresent = parseArrowExample(pickLine(text, 'Present'));
  const exPastSimple = parseArrowExample(pickLine(text, 'Past Simple'));
  const exPastPerfect = parseArrowExample(pickLine(text, 'Past Perfect'));
  const exImperfect = parseArrowExample(pickLine(text, 'Imperfect Context'));

  return {
    term: bracketTerm ? bracketTerm[1].trim() : term,
    part_of_speech,
    primary_translation,
    alternative_meanings,
    synonyms: splitListValue(pickLine(text, 'Synonyms')),
    antonyms: splitListValue(pickLine(text, 'Antonyms')),
    phrasal_verbs: splitListValue(pickLine(text, 'Phrasal Verbs')),
    common_expressions: splitListValue(pickLine(text, 'Common Expressions')),
    slang: splitListValue(pickLine(text, 'Slang')),
    related: splitListValue(pickLine(text, 'Related')),
    verb: {
      type: pickLine(text, 'Type') || 'N/A',
      present: presentPair,
      past_simple: pastSimplePair,
      past_perfect: pastPerfectPair,
      past_imperfect: pastImperfectPair,
      tense_examples: {
        present: exPresent,
        past_simple: exPastSimple,
        past_perfect: exPastPerfect,
        imperfect_context: exImperfect,
      },
    },
    usage: {
      general_en: pickLine(text, 'General Example \(EN\)'),
      general_es: pickLine(text, 'General Example \(ES\)'),
    },
    confidence: 65,
  };
}

async function runDictionaryLookupTool(term, mode) {
  const safeMode = ['en-en', 'en-es', 'es-en'].includes(mode) ? mode : 'en-en';
  const prompt = buildDictionaryLookupPrompt(term, safeMode);
  const lmData = await callLM(prompt, 'chatbot');
  const raw = extractLMText(lmData);
  const parsed = parseLMJson(raw);
  const data = parsed?.ok ? parsed.data : {};
  const fallback = parseDictionaryTextFallback(raw, term, safeMode);

  const cap = (arr, n = 8) => Array.isArray(arr) ? arr.map(x => String(x)).filter(Boolean).slice(0, n) : [];

  const pickText = (a, b, c = '') => String(a || b || c);
  const pickList = (a, b, n = 10) => {
    const first = cap(a, n);
    return first.length ? first : cap(b, n);
  };
  const ensureList = (arr, fallbackItems) => {
    const clean = cap(arr, 10);
    return clean.length ? clean : cap(fallbackItems, 10);
  };

  const normalize = (d, fb) => {
    const confidenceRaw = Number(d?.confidence ?? fb?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : 70;

    const langRaw = String(d?.detected_language || fb?.detected_language || '').toLowerCase();
    const detected_language = langRaw.includes('english')
      ? 'english'
      : langRaw.includes('spanish')
        ? 'spanish'
        : 'unknown';

    return {
    term,
    mode: safeMode,
    detected_language,
    phonetic: pickText(d?.phonetic, fb.phonetic),
    part_of_speech: pickText(d?.part_of_speech, fb.part_of_speech),
    meaning: pickText(d?.meaning, fb.meaning),
    main_translation: pickText(d?.main_translation || d?.translation, fb.main_translation),
    alternative_meanings: pickList(d?.alternative_meanings, fb.alternative_meanings, 8),
    alternative_translations: pickList(d?.alternative_translations, fb.alternative_translations || fb.alternative_meanings, 8),
    translation: pickText(d?.translation || d?.main_translation, fb.translation),
    definitions: pickList(d?.definitions, fb.definitions, 8),
    examples: (Array.isArray(d?.examples)
      ? d.examples
          .map(x => ({ source: String(x?.source || ''), target: String(x?.target || '') }))
          .filter(x => x.source || x.target)
          .slice(0, 6)
      : []).length
      ? (Array.isArray(d?.examples)
        ? d.examples
            .map(x => ({ source: String(x?.source || ''), target: String(x?.target || '') }))
            .filter(x => x.source || x.target)
            .slice(0, 6)
        : [])
      : fb.examples,
    synonyms: pickList(d?.synonyms || d?.near_synonyms, fb.synonyms, 10),
    antonyms: pickList(d?.antonyms || d?.opposites, fb.antonyms, 10),
    phrasal_verbs: pickList(d?.phrasal_verbs || d?.phrasalVerbs, fb.phrasal_verbs, 10),
    common_expressions: pickList(d?.common_expressions || d?.commonExpressions || d?.expressions, fb.common_expressions, 10),
    slang: pickList(d?.slang || d?.slang_colloquial || d?.colloquial, fb.slang, 10),
    related: pickList(d?.related || d?.related_terms || d?.relatedTerms, fb.related, 10),
    notes: pickList(d?.notes || d?.usage_notes || d?.usageNotes, fb.notes, 8),
    confidence,
    };
  };

  const enforceMinimums = (r) => {
    const fixed = { ...r };
    if (!String(fixed.meaning || '').trim() && Array.isArray(fixed.definitions) && fixed.definitions.length) {
      fixed.meaning = String(fixed.definitions[0] || '').trim();
    }
    if (safeMode !== 'en-en') {
      if (!String(fixed.main_translation || '').trim() && String(fixed.translation || '').trim()) {
        fixed.main_translation = String(fixed.translation || '').trim();
      }
      if (!String(fixed.translation || '').trim() && String(fixed.main_translation || '').trim()) {
        fixed.translation = String(fixed.main_translation || '').trim();
      }
    }
    return fixed;
  };

  const finalizeDictionary = (r) => enforceMinimums({
    ...r,
    antonyms: ensureList(r?.antonyms, ['No clear antonyms for this context.']),
    phrasal_verbs: ensureList(r?.phrasal_verbs, ['No common phrasal verbs found for this term.']),
    common_expressions: ensureList(r?.common_expressions, ['No common expressions found for this term.']),
    slang: ensureList(r?.slang, ['No frequent slang usage found for this term.']),
    related: ensureList(r?.related, [term]),
    notes: ensureList(r?.notes, [`Generated in ${safeMode} mode. Meanings may vary by context.`]),
  });

  const primary = enforceMinimums(normalize(data, fallback));
  if (!isSparseDictionaryResult(primary, safeMode)) {
    return finalizeDictionary(primary);
  }

  const repairPrompt = buildDictionaryRepairPrompt(term, safeMode, primary);
  const repairLmData = await callLM(repairPrompt, 'chatbot');
  const repairRaw = extractLMText(repairLmData);
  const repairParsed = parseLMJson(repairRaw);
  const repairData = repairParsed?.ok ? repairParsed.data : {};
  const repairFallback = parseDictionaryTextFallback(repairRaw, term, safeMode);
  const repaired = enforceMinimums(normalize(repairData, repairFallback));

  const textScore = (v) => String(v || '').trim().length;
  const listScore = (arr) => Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(Boolean).length : 0;
  const exampleScore = (arr) => Array.isArray(arr) ? arr.filter(x => textScore(x?.source) || textScore(x?.target)).length : 0;
  const richerText = (a, b) => textScore(b) > textScore(a) ? String(b || '') : String(a || '');
  const richerList = (a, b) => listScore(b) > listScore(a) ? (Array.isArray(b) ? b : []) : (Array.isArray(a) ? a : []);
  const richerExamples = (a, b) => exampleScore(b) > exampleScore(a) ? (Array.isArray(b) ? b : []) : (Array.isArray(a) ? a : []);

  return finalizeDictionary({
    term,
    mode: safeMode,
    detected_language: richerText(primary.detected_language, repaired.detected_language) || primary.detected_language,
    phonetic: richerText(primary.phonetic, repaired.phonetic),
    part_of_speech: richerText(primary.part_of_speech, repaired.part_of_speech),
    meaning: richerText(primary.meaning, repaired.meaning),
    main_translation: richerText(primary.main_translation, repaired.main_translation),
    alternative_meanings: richerList(primary.alternative_meanings, repaired.alternative_meanings),
    alternative_translations: richerList(primary.alternative_translations, repaired.alternative_translations),
    translation: richerText(primary.translation, repaired.translation),
    definitions: richerList(primary.definitions, repaired.definitions),
    examples: richerExamples(primary.examples, repaired.examples),
    synonyms: richerList(primary.synonyms, repaired.synonyms),
    antonyms: richerList(primary.antonyms, repaired.antonyms),
    phrasal_verbs: richerList(primary.phrasal_verbs, repaired.phrasal_verbs),
    common_expressions: richerList(primary.common_expressions, repaired.common_expressions),
    slang: richerList(primary.slang, repaired.slang),
    related: richerList(primary.related, repaired.related),
    notes: richerList(primary.notes, repaired.notes),
    confidence: Math.max(Number(primary.confidence) || 0, Number(repaired.confidence) || 0),
  });
}

function buildVerbRepairPrompt(term, currentData) {
  const safeJson = JSON.stringify(currentData || {}, null, 2);
  return `${VERB_ENGINE_TOOL}

Your previous verb-engine output was incomplete. Repair and enrich it.

Hard requirements:
- Preserve term exactly.
- Keep JSON schema exactly as requested.
- Fill lexical sections with best-effort content.
- If part_of_speech is Verb, provide verb.type and all tense pairs with non-empty en/es when possible.
- Provide usage.general_en and usage.general_es when possible.
- Avoid empty arrays unless strictly unavailable.

Repair input:
- term: ${term}
- current_json: ${safeJson}

Return only valid JSON.`;
}

function isSparseVerbResult(result) {
  const txt = (v) => String(v || '').trim();
  const listLen = (arr) => Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(Boolean).length : 0;
  const pairFilled = (p) => txt(p?.en) || txt(p?.es);

  const lexicalScore =
    listLen(result?.synonyms) +
    listLen(result?.antonyms) +
    listLen(result?.phrasal_verbs) +
    listLen(result?.common_expressions) +
    listLen(result?.slang) +
    listLen(result?.related);

  const usageMissing = !txt(result?.usage?.general_en) && !txt(result?.usage?.general_es);
  const primaryMissing = !txt(result?.primary_translation) && !txt(result?.part_of_speech);

  const isVerb = /verb/i.test(txt(result?.part_of_speech));
  const verbPairs = [
    result?.verb?.present,
    result?.verb?.past_simple,
    result?.verb?.past_perfect,
    result?.verb?.past_imperfect,
  ];
  const verbCoverage = verbPairs.filter(pairFilled).length;
  const verbSparse = isVerb && (verbCoverage < 2 || !txt(result?.verb?.type));

  return primaryMissing || usageMissing || lexicalScore < 3 || verbSparse;
}

async function runVerbEngineTool(term) {
  const prompt = buildVerbEnginePrompt(term);
  const lmData = await callLM(prompt, 'chatbot');
  const raw = extractLMText(lmData);
  const parsed = parseLMJson(raw);
  const data = parsed?.ok ? parsed.data : {};
  const fallback = parseVerbEngineTextFallback(raw, term);

  const cap = (arr, n = 8) => Array.isArray(arr) ? arr.map(x => String(x)).filter(Boolean).slice(0, n) : [];
  const pickText = (a, b, c = '') => String(a || b || c);
  const pickList = (a, b, n = 10) => {
    const first = cap(a, n);
    return first.length ? first : cap(b, n);
  };
  const pair = (obj, fb) => ({
    en: pickText(obj?.en, fb?.en),
    es: pickText(obj?.es, fb?.es),
  });
  const blankPair = { en: '', es: '' };

  const enforceVerbConsistency = (r) => {
    const pos = String(r?.part_of_speech || '').toLowerCase();
    const isVerb = pos.includes('verb');
    if (isVerb) return r;
    return {
      ...r,
      verb: {
        type: 'N/A',
        present: blankPair,
        past_simple: blankPair,
        past_perfect: blankPair,
        past_imperfect: blankPair,
        tense_examples: {
          present: blankPair,
          past_simple: blankPair,
          past_perfect: blankPair,
          imperfect_context: blankPair,
        },
      },
    };
  };

  const normalize = (d, fb) => {
    const confidenceRaw = Number(d?.confidence ?? fb?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : 70;

    return {
      term,
      part_of_speech: pickText(d?.part_of_speech, fb?.part_of_speech),
      primary_translation: pickText(d?.primary_translation || d?.translation, fb?.primary_translation),
      alternative_meanings: pickList(d?.alternative_meanings, fb?.alternative_meanings, 8),
      synonyms: pickList(d?.synonyms, fb?.synonyms, 10),
      antonyms: pickList(d?.antonyms, fb?.antonyms, 10),
      phrasal_verbs: pickList(d?.phrasal_verbs, fb?.phrasal_verbs, 10),
      common_expressions: pickList(d?.common_expressions, fb?.common_expressions, 10),
      slang: pickList(d?.slang, fb?.slang, 10),
      related: pickList(d?.related, fb?.related, 10),
      verb: {
        type: pickText(d?.verb?.type, fb?.verb?.type, 'N/A'),
        present: pair(d?.verb?.present, fb?.verb?.present),
        past_simple: pair(d?.verb?.past_simple, fb?.verb?.past_simple),
        past_perfect: pair(d?.verb?.past_perfect, fb?.verb?.past_perfect),
        past_imperfect: pair(d?.verb?.past_imperfect, fb?.verb?.past_imperfect),
        tense_examples: {
          present: pair(d?.verb?.tense_examples?.present, fb?.verb?.tense_examples?.present),
          past_simple: pair(d?.verb?.tense_examples?.past_simple, fb?.verb?.tense_examples?.past_simple),
          past_perfect: pair(d?.verb?.tense_examples?.past_perfect, fb?.verb?.tense_examples?.past_perfect),
          imperfect_context: pair(d?.verb?.tense_examples?.imperfect_context, fb?.verb?.tense_examples?.imperfect_context),
        },
      },
      usage: {
        general_en: pickText(d?.usage?.general_en, fb?.usage?.general_en),
        general_es: pickText(d?.usage?.general_es, fb?.usage?.general_es),
      },
      confidence,
    };
  };

  const primary = enforceVerbConsistency(normalize(data, fallback));
  if (!isSparseVerbResult(primary)) {
    return primary;
  }

  const repairPrompt = buildVerbRepairPrompt(term, primary);
  const repairLmData = await callLM(repairPrompt, 'chatbot');
  const repairRaw = extractLMText(repairLmData);
  const repairParsed = parseLMJson(repairRaw);
  const repairData = repairParsed?.ok ? repairParsed.data : {};
  const repairFallback = parseVerbEngineTextFallback(repairRaw, term);
  const repaired = enforceVerbConsistency(normalize(repairData, repairFallback));

  const textScore = (v) => String(v || '').trim().length;
  const listScore = (arr) => Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(Boolean).length : 0;
  const richerText = (a, b) => textScore(b) > textScore(a) ? String(b || '') : String(a || '');
  const richerList = (a, b) => listScore(b) > listScore(a) ? (Array.isArray(b) ? b : []) : (Array.isArray(a) ? a : []);
  const richerPair = (a, b) => ({
    en: richerText(a?.en, b?.en),
    es: richerText(a?.es, b?.es),
  });

  return enforceVerbConsistency({
    term,
    part_of_speech: richerText(primary.part_of_speech, repaired.part_of_speech),
    primary_translation: richerText(primary.primary_translation, repaired.primary_translation),
    alternative_meanings: richerList(primary.alternative_meanings, repaired.alternative_meanings),
    synonyms: richerList(primary.synonyms, repaired.synonyms),
    antonyms: richerList(primary.antonyms, repaired.antonyms),
    phrasal_verbs: richerList(primary.phrasal_verbs, repaired.phrasal_verbs),
    common_expressions: richerList(primary.common_expressions, repaired.common_expressions),
    slang: richerList(primary.slang, repaired.slang),
    related: richerList(primary.related, repaired.related),
    verb: {
      type: richerText(primary.verb?.type, repaired.verb?.type),
      present: richerPair(primary.verb?.present, repaired.verb?.present),
      past_simple: richerPair(primary.verb?.past_simple, repaired.verb?.past_simple),
      past_perfect: richerPair(primary.verb?.past_perfect, repaired.verb?.past_perfect),
      past_imperfect: richerPair(primary.verb?.past_imperfect, repaired.verb?.past_imperfect),
      tense_examples: {
        present: richerPair(primary.verb?.tense_examples?.present, repaired.verb?.tense_examples?.present),
        past_simple: richerPair(primary.verb?.tense_examples?.past_simple, repaired.verb?.tense_examples?.past_simple),
        past_perfect: richerPair(primary.verb?.tense_examples?.past_perfect, repaired.verb?.tense_examples?.past_perfect),
        imperfect_context: richerPair(primary.verb?.tense_examples?.imperfect_context, repaired.verb?.tense_examples?.imperfect_context),
      },
    },
    usage: {
      general_en: richerText(primary.usage?.general_en, repaired.usage?.general_en),
      general_es: richerText(primary.usage?.general_es, repaired.usage?.general_es),
    },
    confidence: Math.max(Number(primary.confidence) || 0, Number(repaired.confidence) || 0),
  });
}

async function callLM(prompt, appName) {
  const start   = Date.now();
  const preview = typeof prompt === 'string' ? prompt.slice(0, 120) : null;
  const logId   = logsDB.createLog(appName, MODEL, '/api/v1/chat', preview);
  broadcastSSE('log:pending', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'pending', created_at: Date.now() });

  try {
    const response = await fetch(`${LM_STUDIO}/api/v1/chat`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: MODEL, input: prompt, context_length: 8000 }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    const duration = Date.now() - start;
    const usage    = data.usage ? {
      prompt_tokens:     data.usage.prompt_tokens     || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens:      data.usage.total_tokens      || 0,
    } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    logsDB.updateLog(logId, { status: 'success', duration_ms: duration, ...usage });
    broadcastSSE('log:update', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'success', duration_ms: duration, ...usage, created_at: Date.now() });
    return data;
  } catch (err) {
    const duration = Date.now() - start;
    logsDB.updateLog(logId, { status: 'error', duration_ms: duration, error_message: err.message });
    broadcastSSE('log:update', { id: logId, app: appName, endpoint: '/api/v1/chat', status: 'error', duration_ms: duration, error_message: err.message, created_at: Date.now() });
    throw err;
  }
}

async function callLMFast(prompt, appName) {
  const start   = Date.now();
  const preview = typeof prompt === 'string' ? prompt.slice(0, 120) : null;
  const logId   = logsDB.createLog(appName, MODEL, '/api/v1/chat', preview);
  broadcastSSE('log:pending', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'pending', created_at: Date.now() });

  try {
    const response = await fetch(`${LM_STUDIO}/api/v1/chat`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: MODEL, input: prompt, context_length: 1024, temperature: 0.2 }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    const duration = Date.now() - start;
    const usage    = data.usage ? {
      prompt_tokens:     data.usage.prompt_tokens     || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens:      data.usage.total_tokens      || 0,
    } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    logsDB.updateLog(logId, { status: 'success', duration_ms: duration, ...usage });
    broadcastSSE('log:update', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'success', duration_ms: duration, ...usage, created_at: Date.now() });
    return data;
  } catch (err) {
    const duration = Date.now() - start;
    logsDB.updateLog(logId, { status: 'error', duration_ms: duration, error_message: err.message });
    broadcastSSE('log:update', { id: logId, app: appName, endpoint: '/api/v1/chat', status: 'error', duration_ms: duration, error_message: err.message, created_at: Date.now() });
    throw err;
  }
}

function extractLMText(data) {
  if (data.choices?.length) {
    const c = data.choices[0];
    if (typeof c.message?.content === 'string') return c.message.content;
    if (typeof c.text === 'string') return c.text;
  }
  if (data.output) {
    if (typeof data.output === 'string') return data.output;
    if (Array.isArray(data.output)) return data.output.map(b => b?.text ?? b?.content ?? JSON.stringify(b)).join('');
    if (data.output.text)    return data.output.text;
    if (data.output.content) return data.output.content;
  }
  if (typeof data.response === 'string') return data.response;
  return JSON.stringify(data);
}

function normalizeJsonLike(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')   // strip opening fence
    .replace(/```\s*$/i, '')            // strip closing fence
    .replace(/[\u201c\u201d]/g, '"')    // curly double quotes → straight
    .replace(/[\u2018\u2019]/g, "'")    // curly single quotes → straight
    .replace(/,\s*([}\]])/g, '$1')      // trailing commas
    .trim();
}

function tryParseJsonCandidates(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeJsonLike(candidate);
    try { return JSON.parse(normalized); } catch (_) {}
  }
  return null;
}

/**
 * Robust LLM-output JSON parser.
 *
 * Strategy (in order of confidence):
 *  1. Direct JSON.parse on the raw text.
 *  2. normalizeJsonLike → JSON.parse  (handles fences, smart-quotes, trailing commas).
 *  3. Extract ```json...``` fence content and parse.
 *  4. Use extractBalancedBlock to find the first well-formed {...} object, then parse.
 *  5. Greedy-regex fallback: /\{[\s\S]*\}/ then normalize+parse.
 */
function parseLMJson(text) {
  if (!text) return { ok: false, data: { raw: true, summary: '' } };

  // 1 — direct
  try { return { ok: true, data: JSON.parse(text) }; } catch (_) {}

  // 2 — normalize first, then parse
  try { return { ok: true, data: JSON.parse(normalizeJsonLike(text)) }; } catch (_) {}

  // 3 — pull content out of a ```json … ``` fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try { return { ok: true, data: JSON.parse(fenceMatch[1]) }; } catch (_) {}
    try { return { ok: true, data: JSON.parse(normalizeJsonLike(fenceMatch[1])) }; } catch (_) {}
  }

  // 4 — find first balanced { … } (depth-correct, handles nested objects)
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    const balanced = extractBalancedBlock(text, firstBrace, '{', '}');
    if (balanced) {
      try { return { ok: true, data: JSON.parse(balanced) }; } catch (_) {}
      try { return { ok: true, data: JSON.parse(normalizeJsonLike(balanced)) }; } catch (_) {}
    }
  }

  // 5 — greedy regex fallback (still handles most single-object cases)
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch?.[0]) {
    try { return { ok: true, data: JSON.parse(greedyMatch[0]) }; } catch (_) {}
    try { return { ok: true, data: JSON.parse(normalizeJsonLike(greedyMatch[0])) }; } catch (_) {}
  }

  return { ok: false, data: { raw: true, summary: text.trim() } };
}

function extractBalancedBlock(text, startIndex, openChar, closeChar) {
  if (startIndex < 0 || text[startIndex] !== openChar) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;
    if (depth === 0) return text.slice(startIndex, i + 1);
  }

  return text.slice(startIndex);
}

function extractDataArray(text) {
  if (!text || typeof text !== 'string') return [];
  const dataKey = text.match(/"data"\s*:\s*\[/i) || text.match(/\bdata\b\s*:\s*\[/i);
  if (!dataKey || typeof dataKey.index !== 'number') return [];

  const arrayStart = text.indexOf('[', dataKey.index);
  if (arrayStart < 0) return [];

  const arrayBlock = extractBalancedBlock(text, arrayStart, '[', ']');
  if (!arrayBlock) return [];

  const parsed = tryParseJsonCandidates([arrayBlock]);
  return Array.isArray(parsed) ? parsed : [];
}

function recoverEntriesFromDataArray(text) {
  if (!text || typeof text !== 'string') return [];
  const dataKey = text.match(/"data"\s*:\s*\[/i) || text.match(/\bdata\b\s*:\s*\[/i);
  if (!dataKey || typeof dataKey.index !== 'number') return [];

  const arrayStart = text.indexOf('[', dataKey.index);
  if (arrayStart < 0) return [];

  const entries = [];
  let i = arrayStart + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,\r\n\t]/.test(text[i])) i++;
    if (i >= text.length || text[i] === ']') break;
    if (text[i] !== '{') {
      i++;
      continue;
    }

    const objectBlock = extractBalancedBlock(text, i, '{', '}');
    if (!objectBlock || objectBlock[objectBlock.length - 1] !== '}') break;

    const parsed = tryParseJsonCandidates([objectBlock]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      entries.push(parsed);
    }

    i += objectBlock.length;
  }

  return entries;
}

app.get('/api/chatbot/conversations', (req, res) => {
  res.json(chatbotDB.listConversations());
});

app.post('/api/chatbot/conversations', (req, res) => {
  const conv = chatbotDB.createConversation('New Conversation');
  res.status(201).json(conv);
});

app.delete('/api/chatbot/conversations/:id', (req, res) => {
  chatbotDB.deleteConversation(Number(req.params.id));
  res.sendStatus(204);
});

app.get('/api/chatbot/conversations/:id/messages', (req, res) => {
  const messages = chatbotDB.getMessages(Number(req.params.id));
  res.json(messages);
});

const PHRASE_ARCHITECT_SYSTEM = `### Role
You are the "Professional English Architect," an expert in Corporate Linguistics and Business Communication. Your goal is to generate a comprehensive, high-level database of professional phrases used in modern corporate environments.

### Objective
Create a multi-category library of phrases that cover the full spectrum of professional life, ranging from "Polite Inquiry" to "Executive Decision Making."

### Instructions for Content Generation
1. **Contextual Variety:** Generate phrases for:
   - Meetings (Opening, Interrupting, Summarizing, Closing).
   - Queries (Asking for data, clarifying instructions, follow-ups).
   - Upward Communication (Talking to superiors, asking for feedback, reporting issues).
   - Peer Collaboration (Brainstorming, casual check-ins, thanking colleagues).
   - Meeting Ideas/Strategy (Proposing a pivot, identifying key topics).
2. **Native Precision:** For every phrase, provide a "Native Standard" version (how a high-level professional actually sounds).
3. **Bilingual Output:** Provide the natural Spanish equivalent for every entry.

### Categorization Logic
You must create highly specific categories. Do not just use "Work." Use tags like: Strategic_Planning, Conflict_Resolution, Project_Milestones, Email_Etiquette, Casual_Sync.

### Output Format (Database Ready)
First, provide a brief, professional summary of the categories generated.
Then, output a valid JSON block containing the data. This JSON will be used to populate a "Quick Lookup" page.

---
### [DATABASE_ENTRY]
\`\`\`json
{
  "total_phrases": 0,
  "data": [
    {
      "category": "[Category_Name]",
      "context": "[Brief description of when to use this]",
      "phrase_en": "[The English Professional Phrase]",
      "phrase_es": "[The Spanish Equivalent]",
      "level": "[Formal / Professional Casual / Executive]"
    }
  ]
}
\`\`\``;

function parseArchitectBlock(text) {
  if (!text || typeof text !== 'string') return [];

  const candidates = [];

  const labeledFence = text.match(/\[DATABASE_ENTRY\][\s\S]*?```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (labeledFence?.[1]) candidates.push(labeledFence[1]);

  const genericFences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const match of genericFences) {
    if (match?.[1]) candidates.push(match[1]);
  }

  const dataArrayObject = text.match(/\{[\s\S]*?"data"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/i);
  if (dataArrayObject?.[0]) candidates.push(dataArrayObject[0]);

  const firstObject = text.match(/\{[\s\S]*\}/);
  if (firstObject?.[0]) candidates.push(firstObject[0]);

  const parsed = tryParseJsonCandidates(candidates);
  if (parsed && Array.isArray(parsed.data)) {
    return parsed.data.filter(entry => entry && typeof entry === 'object');
  }

  const recovered = extractDataArray(text);
  if (recovered.length) {
    return recovered.filter(entry => entry && typeof entry === 'object');
  }

  const partial = recoverEntriesFromDataArray(text);
  if (partial.length) {
    return partial.filter(entry => entry && typeof entry === 'object');
  }

  return [];
}

function extractArchitectSummary(text) {
  if (!text || typeof text !== 'string') return '';
  const withoutJson = String(text)
    .replace(/\[DATABASE_ENTRY\][\s\S]*$/i, '')
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .trim();
  return withoutJson.slice(0, 2000);
}

function normalizeImportedPhrase(item) {
  if (!item || typeof item !== 'object') return null;
  const category = String(item.category || item.tag || item.group || '').trim();
  const phraseEn = String(item.phrase_en || item.en || item.text_en || item.english || '').trim();
  const phraseEs = String(item.phrase_es || item.es || item.text_es || item.spanish || '').trim();
  const style = String(item.style || item.level || item.tone || '').trim();
  if (!category || !phraseEn || !phraseEs) return null;
  return {
    category,
    phrase_en: phraseEn,
    phrase_es: phraseEs,
    style,
  };
}

function parseImportedPhrasePayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const candidates = [
    Array.isArray(payload) ? payload : null,
    Array.isArray(root.items) ? root.items : null,
    Array.isArray(root.data) ? root.data : null,
    root.database_entry && Array.isArray(root.database_entry.entries) ? root.database_entry.entries : null,
    Array.isArray(root.entries) ? root.entries : null,
  ].filter(Boolean);

  const items = candidates[0] || [];
  const normalized = items.map(normalizeImportedPhrase).filter(Boolean);
  return {
    items: normalized,
    total: items.length,
    invalid: Math.max(0, items.length - normalized.length),
  };
}

app.get('/api/chatbot/phrase-bank', (req, res) => {
  try {
    const category = req.query.category ? String(req.query.category).trim() : undefined;
    const items = chatbotDB.listPhrases(category || undefined);
    const categories = chatbotDB.getPhraseStats();
    res.json({ items, categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/phrase-bank/generate', async (req, res) => {
  try {
    const lmData = await callLM(PHRASE_ARCHITECT_SYSTEM, 'chatbot');
    const raw = extractLMText(lmData);
    const entries = parseArchitectBlock(raw);
    const summary = extractArchitectSummary(raw);

    if (!entries.length) {
      return res.status(422).json({
        error: 'The LLM response did not contain any valid phrase entries.',
        preview: String(raw || '').slice(0, 1200),
      });
    }

    // Map architect schema (level, context) → phrase_bank_v2 schema (style)
    const mapped = entries.map(e => ({
      category:  e.category,
      phrase_en: e.phrase_en,
      phrase_es: e.phrase_es,
      style:     e.level || '',
    }));

    const sessionId = `architect_${Date.now()}`;
    const { saved } = chatbotDB.upsertPhrases(null, sessionId, mapped);
    const categories = chatbotDB.getPhraseStats();
    res.json({ saved, total: entries.length, categories, summary, generated: entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/phrase-bank/import', (req, res) => {
  try {
    const { items, total, invalid } = parseImportedPhrasePayload(req.body);
    if (!items.length) {
      return res.status(400).json({
        error: 'No valid phrase entries found in the JSON payload.',
        accepted_formats: ['array', '{ items: [] }', '{ data: [] }', '{ entries: [] }', '{ database_entry: { entries: [] } }'],
      });
    }

    const sessionId = `import_${Date.now()}`;
    const { saved } = chatbotDB.upsertPhrases(null, sessionId, items, 'import');
    const categories = chatbotDB.getPhraseStats();
    res.status(201).json({ saved, total, invalid, categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chatbot/phrase-bank/review', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const items = chatbotDB.getLeastSeenPhrases(limit);
    res.json({ items, total: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/pronunciation/check', async (req, res) => {
  try {
    const phrase = String(req.body?.phrase || '').trim();
    const transcript = String(req.body?.transcript || '').trim();
    const accentRaw = String(req.body?.accent || 'american').trim().toLowerCase();
    const accent = accentRaw === 'british' ? 'british' : 'american';

    if (!phrase) return res.status(400).json({ error: 'phrase is required' });
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    const review = await runPronunciationReviewTool(phrase, transcript, accent);
    res.json({ ok: true, review });
  } catch (e) {
    res.status(502).json({ error: `Pronunciation checker failed: ${e.message}` });
  }
});

app.post('/api/chatbot/dictionary/lookup', async (req, res) => {
  try {
    const term = String(req.body?.term || '').trim();
    const mode = String(req.body?.mode || 'en-en').trim().toLowerCase();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const result = await runDictionaryLookupTool(term, mode);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: `Dictionary lookup failed: ${e.message}` });
  }
});

app.post('/api/chatbot/verbs/lookup', async (req, res) => {
  try {
    const term = String(req.body?.term || '').trim();
    if (!term) return res.status(400).json({ error: 'term is required' });
    const result = await runVerbEngineTool(term);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: `Verb engine lookup failed: ${e.message}` });
  }
});

app.get('/api/chatbot/verbs/library', (req, res) => {
  try {
    const toBaseForms = (rows) => {
      const seen = new Set();
      const out = [];
      for (const row of rows || []) {
        const base = String(row?.base_form || '').trim().toLowerCase();
        if (!base || seen.has(base)) continue;
        seen.add(base);
        out.push(base);
      }
      return out.sort((a, b) => a.localeCompare(b));
    };

    const irregular = toBaseForms(teacherDB.getAllIrregularVerbs(FIXED_PROFILE_ID));
    const regular = toBaseForms(teacherDB.getAllRegularVerbs(FIXED_PROFILE_ID));

    res.json({
      ok: true,
      profileId: FIXED_PROFILE_ID,
      regular,
      irregular,
      total: regular.length + irregular.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/session-state', (req, res) => {
  try {
    const payload = req.body?.sessionState && typeof req.body.sessionState === 'object'
      ? req.body.sessionState
      : req.body;

    const profileId = String(payload?.profileId || '').trim();
    const sessionNumber = String(payload?.sessionNumber || '').trim();

    if (!profileId) return res.status(400).json({ error: 'profileId is required' });
    if (profileId !== FIXED_PROFILE_ID) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE_ID}` });
    if (!sessionNumber) return res.status(400).json({ error: 'sessionNumber is required' });

    const saved = chatbotDB.upsertSessionState({ ...payload, profileId: FIXED_PROFILE_ID });
    res.status(201).json({ ok: true, sessionState: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chatbot/session-state', (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const sessionNumber = String(req.query.sessionNumber || '').trim();

    if (!profileId) return res.status(400).json({ error: 'profileId query param is required' });
    if (profileId !== FIXED_PROFILE_ID) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE_ID}` });

    const state = sessionNumber
      ? chatbotDB.getSessionState(FIXED_PROFILE_ID, sessionNumber)
      : chatbotDB.getLatestSessionState(FIXED_PROFILE_ID);

    if (!state) return res.status(404).json({ error: 'Session state not found' });
    res.json({ ok: true, sessionState: state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/vocabulary-cards', (req, res) => {
  try {
    const payload = req.body?.vocabularyCards && typeof req.body.vocabularyCards === 'object'
      ? req.body.vocabularyCards
      : req.body;

    const profileId = String(payload?.profileId || '').trim();
    const sessionNumber = String(payload?.sessionNumber || '').trim();
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];

    if (!profileId) return res.status(400).json({ error: 'profileId is required' });
    if (profileId !== FIXED_PROFILE_ID) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE_ID}` });
    if (!sessionNumber) return res.status(400).json({ error: 'sessionNumber is required' });
    if (!cards.length) return res.status(400).json({ error: 'cards array is required' });

    const saved = chatbotDB.upsertVocabularyCards(FIXED_PROFILE_ID, sessionNumber, cards);
    res.status(201).json({ ok: true, vocabularyCards: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chatbot/vocabulary-cards', (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const sessionNumber = String(req.query.sessionNumber || '').trim();

    if (!profileId) return res.status(400).json({ error: 'profileId query param is required' });
    if (profileId !== FIXED_PROFILE_ID) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE_ID}` });

    const cards = sessionNumber
      ? chatbotDB.getVocabularyCards(FIXED_PROFILE_ID, sessionNumber)
      : chatbotDB.getLatestVocabularyCards(FIXED_PROFILE_ID);

    res.json({ ok: true, cards, total: cards.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chatbot/conversations/:id/messages', async (req, res) => {
  const conversationId = Number(req.params.id);
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > 4000) return res.status(400).json({ error: 'Text too long (max 4000 chars)' });

  const conv = chatbotDB.getConversation(conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const history = chatbotDB.getMessages(conversationId);
  if (history.length === 0) chatbotDB.updateTitle(conversationId, text);

  chatbotDB.addMessage(conversationId, 'user', text.trim());

  try {
    const sessionId = `conv_${conversationId}`;

    // ── RAG: 3-tier automatic phrase bank injection ───────────────────────────
    // Tier 1: topic-matched (keyword search in EN + ES + category)
    const keywords  = extractKeywords(text.trim());
    const tier1     = chatbotDB.searchContextPhrases(keywords, 5);
    const tier1Ids  = tier1.map(p => p.id);

    // Tier 2: user's most-mastered phrases not already in tier1
    // Always injected so Aria can reinforce known vocab even on off-topic messages
    const tier2     = chatbotDB.getMostPracticedPhrases(tier1Ids, 3);
    const tier2Ids  = tier2.map(p => p.id);

    // Tier 3: compact bank summary so LLM knows the learner's full breadth
    const bankSummary = chatbotDB.getBankSummary();

    // Mark all injected phrases as seen (drives spaced-repetition ranking)
    chatbotDB.markPhrasesAsSeen([...tier1Ids, ...tier2Ids]);

    const ragContext = { tier1, tier2, summary: bankSummary };
    const prompt  = buildChatbotOnePassPrompt(text.trim(), history, sessionId, ragContext);
    const lmData  = await callLM(prompt, 'chatbot');
    const rawReply = extractLMText(lmData);
    const { data: parsed } = parseLMJson(rawReply);

    const parsedRoot = parsed && typeof parsed === 'object' ? parsed : {};
    const parsedDb = parsedRoot.database_entry && typeof parsedRoot.database_entry === 'object'
      ? parsedRoot.database_entry
      : {};
    const candidateEntries = Array.isArray(parsedDb.entries)
      ? parsedDb.entries
      : Array.isArray(parsedRoot.phrase_extract)
        ? parsedRoot.phrase_extract
        : [];
    const phraseExtract = candidateEntries.map(normalizeImportedPhrase).filter(Boolean);

    const databaseEntry = {
      session_id: String(parsedDb.session_id || sessionId),
      entries: phraseExtract,
    };
    if (phraseExtract.length) {
      const saveResult = chatbotDB.upsertPhrases(conversationId, databaseEntry.session_id, phraseExtract);
      databaseEntry.saved = saveResult.saved;
    }

    const finalResponse = {
      ...parsedRoot,
      bilingual_block: String(parsedRoot.bilingual_block || ''),
      phrase_extract: phraseExtract,
      database_entry: databaseEntry,
      rag_context: {
        tier1: tier1.map(p => ({ id: p.id, category: p.category, phrase_en: p.phrase_en, times_seen: p.times_seen })),
        tier2: tier2.map(p => ({ id: p.id, category: p.category, phrase_en: p.phrase_en, times_seen: p.times_seen })),
        bank_total: bankSummary?.total || 0,
      },
    };
    const assistantMsg = chatbotDB.addMessage(conversationId, 'assistant', JSON.stringify(finalResponse));
    res.json({ assistantMessageId: assistantMsg.id, response: finalResponse });
  } catch (err) {
    res.status(502).json({ error: `LM Studio error: ${err.message}` });
  }
});

app.post('/api/chatbot-fast/improve', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 2000) return res.status(400).json({ error: 'Text too long (max 2000 chars)' });

  const prompt = `${FAST_CHATBOT_SYSTEM}\n\nUser text: ${text}\n\nReturn only valid JSON.`;

  try {
    const lmData = await callLMFast(prompt, 'chatbot_fast');
    const raw = extractLMText(lmData);
    const parsed = parseLMJson(raw);
    const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};

    const improved = String(data.improved_en || data.option_2?.text || data.option_1?.text || text).trim();
    const translation = String(data.translation_es || data.translation || '').trim();

    if (!improved) {
      return res.status(422).json({ error: 'Model returned empty improved text' });
    }

    const translationForSave = translation || text;
    const phraseEntry = [{
      category: 'Fast_Improver',
      phrase_en: improved,
      phrase_es: translationForSave,
      style: 'Casual',
    }];
    const saveResult = chatbotDB.upsertPhrases(null, 'chatbot_fast', phraseEntry, 'chatbot_fast');

    res.json({ improved_en: improved, translation_es: translation, saved_to_phrase_bank: saveResult.saved });
  } catch (err) {
    res.status(502).json({ error: `LM Studio error: ${err.message}` });
  }
});

// ── API: Bookmark ──────────────────────────────────────────────────────────────────
app.get('/api/bookmark/bookmarks', (req, res) => {
  try { res.json(bookmarkDB.getAllBookmarks()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookmark/bookmarks/batch', (req, res) => {
  try {
    const { bookmarks } = req.body;
    if (!Array.isArray(bookmarks)) return res.status(400).json({ error: 'bookmarks array required' });
    const result = bookmarkDB.saveBookmarks(bookmarks);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/bookmark/bookmarks/:id', (req, res) => {
  try {
    const bm = req.body;
    if (!bm || !bm.id) return res.status(400).json({ error: 'bookmark with id required' });
    bookmarkDB.updateBookmark(bm);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bookmark/bookmarks', (req, res) => {
  try {
    const { sourceFile } = req.query;
    if (!sourceFile) return res.status(400).json({ error: 'sourceFile query param required' });
    bookmarkDB.deleteBySource(sourceFile);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bookmark/folders', (req, res) => {
  try { res.json(bookmarkDB.getAllFolders()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookmark/folders', (req, res) => {
  try {
    const { folders } = req.body;
    if (!Array.isArray(folders)) return res.status(400).json({ error: 'folders array required' });
    bookmarkDB.saveFolders(folders);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bookmark/imports', (req, res) => {
  try { res.json(bookmarkDB.getAllImports()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookmark/imports', (req, res) => {
  try {
    const record = req.body;
    const id = bookmarkDB.saveImport(record);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bookmark/imports/:id', (req, res) => {
  try {
    bookmarkDB.deleteImport(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bookmark/all', (req, res) => {
  try { bookmarkDB.clearAll(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bookmark/export', (req, res) => {
  try {
    const json = bookmarkDB.exportJSON();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="bookmarks-db-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookmark/import', (req, res) => {
  try {
    const { json } = req.body;
    if (!json) return res.status(400).json({ error: 'json string required' });
    const result = bookmarkDB.importJSON(json);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallbacks ────────────────────────────────────────────────────────────────
app.get('/app/bookmark*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bookmark', 'index.html')));
app.get('/app/chatbot/phrase-bank', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot', 'phrase-bank.html')));
app.get('/app/chatbot/dictionary',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot', 'dictionary.html')));
app.get('/app/chatbot/verbs',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot', 'verbs.html')));

app.get('/app/chatbot-fast*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot-fast', 'index.html')));
app.get('/app/teacher*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher', 'index.html')));
app.get('/app/chatbot*',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatbot',  'index.html')));
app.get('*',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Startup ──────────────────────────────────────────────────────────────────────
// Auto-prune old logs on startup
logsDB.prune();

function printStartupBanner(activePort) {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║         LM STUDIO HUB - v1.0             ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Dashboard:      http://localhost:${activePort}`);
  console.log(`  Bookmark:       http://localhost:${activePort}/app/bookmark`);
  console.log(`  Chatbot:        http://localhost:${activePort}/app/chatbot`);
  console.log(`  Chatbot Fast:   http://localhost:${activePort}/app/chatbot-fast`);
  console.log(`  Teacher App:    http://localhost:${activePort}/app/teacher`);
  console.log(`  LM Studio:      ${LM_STUDIO}`);
  console.log('');
  console.log('  Ctrl+C para detener');
  console.log('');
}

function startServer(preferredPort, attempt = 0) {
  const activePort = preferredPort + attempt;
  const server = app.listen(activePort, () => {
    if (attempt > 0) {
      console.warn(`Port ${preferredPort} is busy. Started on port ${activePort} instead.`);
    }
    printStartupBanner(activePort);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      startServer(preferredPort, attempt + 1);
      return;
    }
    console.error('Failed to start LM Studio Hub:', err.message);
    process.exit(1);
  });
}

startServer(PORT);
