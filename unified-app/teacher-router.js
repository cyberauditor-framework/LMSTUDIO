'use strict';

/**
 * teacher-router.js — Standalone Express Router for the Teacher App.
 *
 * Mount in server.js:
 *   const createTeacherRouter = require('./teacher-router');
 *   app.use('/api/teacher', createTeacherRouter({ broadcastSSE }));
 *
 * API surface (all under /api/teacher):
 *   POST /generate-session
 *   POST /generate-section
 *   POST /content-packs
 *   GET  /content-packs
 *   GET  /content-packs/:id
 *   POST /maintenance/clear-saved-sessions
 *   POST /session-state
 *   GET  /session-state
 *   POST /vocabulary-cards
 *   GET  /vocabulary-cards
 *   POST /irregular-verbs/generate
 *   GET  /irregular-verbs
 *   POST /regular-verbs/generate
 *   GET  /regular-verbs
 *   POST /phrasal-verbs/generate
 *   GET  /phrasal-verbs
 */

const express   = require('express');
const logsDB    = require('./db/logs-db');
const teacherDB = require('./db/teacher-db');

// ── Config ────────────────────────────────────────────────────────────────────
const LM_STUDIO       = 'http://127.0.0.1:1234';
const MODEL           = 'google/gemma-3-4b';
const TOKEN           = 'sk-lm-7Qe2aLmR:K7pWv4Hj3AJRl85Kk3Y0';
const FIXED_PROFILE   = 'daniel';

// ── Master irregular-verb list (~250 unique verbs, ordered by frequency) ─────
const MASTER_IRREGULAR_VERBS = [
  // Tier 1 – essential / highest frequency
  'be','have','do','say','go','get','make','know','think','take',
  'see','come','want','give','find','tell','become','show','leave','feel',
  'put','bring','begin','keep','hold','write','stand','hear','let','mean',
  'set','meet','run','pay','sit','speak','lie','lead','read','grow',
  'lose','fall','send','build','understand','buy','wear','choose','break',
  'throw','catch','teach','fight','sell',
  // Tier 2 – high-frequency
  'ring','hang','hide','shake','shoot','bite','blow','steal','stick','beat',
  'cut','hurt','drive','ride','eat','drink','sleep','wake','fly','sing',
  'swim','draw','feed','bleed','burn','deal','dig','dream','freeze','grind',
  'kneel','lay','lean','leap','learn','lend','light',
  // Tier 3 – intermediate
  'arise','awake','bear','bend','bid','bind','breed','broadcast','burst',
  'cast','cling','cost','creep','dive','dwell','flee','fling','forbid',
  'forecast','forgive','knit','quit','rise','seek','sew','shed','shine',
  'shrink','shut','sink','slide','smell','speed','spend','spill','spin',
  'spoil','spread','spring','sting','stink','stride','strike','strive',
  'swear','sweep','swing','tear','weep','win','wind',
  // Tier 4 – less common
  'forsake','mistake','slit','abide','alight','bet','cleave','clothe','fit',
  'hamstring','inlay','plead','prove','rid','slay','sling','slink','smite',
  'tread','wed','wet','wring','mow','weave','string','chide','strew',
  // Tier 5 – prefixed / compound
  'overcome','undergo','undertake','withdraw','withhold','withstand',
  'outdo','outgrow','outrun','outshine','outsell','outsit','outswim',
  'overthrow','overtake','oversee','overhear','overlook','overpay',
  'override','overrun','overshoot','oversleep','overspend',
  'rebuild','redo','remake','repay','reset','rethink','rewrite','reread',
  'relay','mislead','misread','misspend','misunderstand','mishear',
  'uphold','upset','forego','partake','browbeat','waylay','typecast',
  'befall','behold','beseech','gainsay','disprove','interweave','proofread',
];

const MASTER_VERB_LIST = [...new Set(MASTER_IRREGULAR_VERBS)];

// ── Regular-verb topic categories (open-ended generation) ────────────────────
const REGULAR_VERB_CATEGORIES = [
  'Movement & Physical Actions',
  'Communication & Speech',
  'Work & Business',
  'Technology & Digital',
  'Education & Learning',
  'Health & Medicine',
  'Cooking & Food',
  'Travel & Transportation',
  'Arts & Entertainment',
  'Sports & Exercise',
  'Environment & Nature',
  'Finance & Economy',
  'Science & Research',
  'Law & Administration',
  'Construction & Making',
  'Agriculture & Gardening',
  'Relationships & Social',
  'Emotions & Psychology',
  'Leadership & Management',
  'Trade & Commerce',
  'Media & Publishing',
  'Fashion & Appearance',
  'Housing & Architecture',
  'Military & Security',
  'Religion & Philosophy',
];

// ── Phrasal-verb topic categories (open-ended generation) ────────────────────
const PHRASAL_VERB_CATEGORIES = [
  'Movement & Direction',
  'Communication & Speech',
  'Work & Business',
  'Relationships & Social',
  'Emotions & Mental',
  'Daily Routines',
  'Problems & Solutions',
  'Money & Finance',
  'Time & Planning',
  'Learning & Knowledge',
  'Health & Body',
  'Technology & Digital',
  'Authority & Rules',
  'Travel & Places',
  'Nature & Environment',
  'Making & Creating',
  'Organization & Planning',
  'Success & Failure',
  'Change & Development',
  'Food & Cooking',
];

// ── LLM helpers ───────────────────────────────────────────────────────────────
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

// Repairs the three most common LLM JSON defects without touching string values.
// Uses a character-level state machine to track string boundaries so that URLs
// (https://) and other slash sequences inside strings are never misidentified
// as comments.
function repairJson(str) {
  let out   = '';
  let inStr = false;
  let esc   = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc)                 { out += c; esc = false; continue; }
    if (c === '\\' && inStr) { out += c; esc = true;  continue; }
    if (c === '"')           { inStr = !inStr; out += c; continue; }
    if (inStr)               { out += c; continue; }

    // Outside a string: strip // line comments
    if (c === '/' && str[i + 1] === '/') {
      while (i < str.length && str[i] !== '\n') i++;
      continue;
    }
    // Outside a string: strip /* */ block comments
    if (c === '/' && str[i + 1] === '*') {
      i += 2;
      while (i < str.length - 1 && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i++; // skip closing '/'
      continue;
    }
    out += c;
  }

  // Wrap bare /ipa-like/ values in quotes (e.g. "ipa": /miːn/ → "ipa": "/miːn/")
  out = out.replace(/([:,\[]\s*)\/([^/\n]+)\//g, '$1"/$2/"');
  // Pass 1 – add missing commas between inline-adjacent } ] and { [ (e.g. }{  or ][ with any whitespace)
  out = out.replace(/([}\]])(\s*)([{[])/g, '$1,$2$3');
  // Pass 2 – add missing commas between consecutive lines: catches "value"\n"key",
  // true/false\n"key" (e ends true/false, l ends null), and "value"\n{ etc.
  out = out.replace(/(["\}\]\del])([ \t]*\n)([ \t]*)(["\{\[\dtfn])/g, '$1,$2$3$4');
  // Remove trailing commas before } or ] (cleans up any over-additions from both passes)
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

// Last-resort extractor: walks the raw text with a string-aware state machine and
// pulls out every top-level {…} object individually, bypassing any array-level
// comma issues.  For each slice, direct JSON.parse is tried first; if that also
// fails due to intra-object defects, repairJson is applied to the slice before
// retrying — so one malformed object never silently kills the rest.
function extractJsonObjects(str) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc   = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc)                 { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true;  continue; }
    if (c === '"')           { inStr = !inStr; continue; }
    if (inStr)               continue;

    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const slice = str.slice(start, i + 1);
        try {
          objects.push(JSON.parse(slice));
        } catch (_) {
          try { objects.push(JSON.parse(repairJson(slice))); } catch (_) {}
        }
        start = -1;
      }
    }
  }
  return objects;
}

function parseLLMJson(raw) {
  let str = (raw || '').trim();

  // Strip markdown fences first
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    str = fence[1].trim();
  } else {
    // Find whichever valid JSON root token comes first: { or [
    const objStart = str.indexOf('{');
    const arrStart = str.indexOf('[');
    if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
      const arrEnd = str.lastIndexOf(']');
      if (arrEnd !== -1) str = str.slice(arrStart, arrEnd + 1);
    } else if (objStart !== -1) {
      const objEnd = str.lastIndexOf('}');
      if (objEnd !== -1) str = str.slice(objStart, objEnd + 1);
    }
  }

  // Tier 1: well-formed output
  try { return JSON.parse(str); } catch (_) {}

  // Tier 2: regex repair (comments, missing commas, bare IPA), then retry
  const repaired = repairJson(str);
  try { return JSON.parse(repaired); } catch (_) {}

  // Tier 3: extract individual objects — try the repaired string first (intra-object
  // commas already fixed) then fall back to the original.
  const objects = extractJsonObjects(repaired);
  if (objects.length) return objects;
  const fromOrig = extractJsonObjects(str);
  if (fromOrig.length) return fromOrig;

  throw new Error('Could not parse LLM JSON response after all repair attempts');
}

async function callLMLarge(prompt, appName, broadcastSSE, timeoutMs = 90000) {
  const start      = Date.now();
  const preview    = typeof prompt === 'string' ? prompt.slice(0, 120) : null;
  const logId      = logsDB.createLog(appName, MODEL, '/api/v1/chat', preview);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  broadcastSSE('log:pending', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'pending', created_at: Date.now() });

  try {
    const response = await fetch(`${LM_STUDIO}/api/v1/chat`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: MODEL, input: prompt, context_length: 16000, temperature: 0.7 }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data     = await response.json();
    const duration = Date.now() - start;
    const usage    = data.usage
      ? { prompt_tokens: data.usage.prompt_tokens || 0, completion_tokens: data.usage.completion_tokens || 0, total_tokens: data.usage.total_tokens || 0 }
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    logsDB.updateLog(logId, { status: 'success', duration_ms: duration, ...usage });
    broadcastSSE('log:update', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'success', duration_ms: duration, ...usage, created_at: Date.now() });
    return data;
  } catch (err) {
    clearTimeout(timer);
    const duration = Date.now() - start;
    const msg      = err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message;
    logsDB.updateLog(logId, { status: 'error', duration_ms: duration, error_message: msg });
    broadcastSSE('log:update', { id: logId, app: appName, endpoint: '/api/v1/chat', status: 'error', duration_ms: duration, error_message: msg, created_at: Date.now() });
    throw new Error(msg);
  }
}

async function callLMTeacherSafe(prompt, appName, broadcastSSE, timeoutMs = 35000) {
  const start      = Date.now();
  const preview    = typeof prompt === 'string' ? prompt.slice(0, 120) : null;
  const logId      = logsDB.createLog(appName, MODEL, '/api/v1/chat', preview);
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  broadcastSSE('log:pending', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'pending', created_at: Date.now() });

  try {
    const response = await fetch(`${LM_STUDIO}/api/v1/chat`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: MODEL, input: prompt, context_length: 7000, temperature: 0.65 }),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data     = await response.json();
    const duration = Date.now() - start;
    const usage    = data.usage
      ? { prompt_tokens: data.usage.prompt_tokens || 0, completion_tokens: data.usage.completion_tokens || 0, total_tokens: data.usage.total_tokens || 0 }
      : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    logsDB.updateLog(logId, { status: 'success', duration_ms: duration, ...usage });
    broadcastSSE('log:update', { id: logId, app: appName, model: MODEL, endpoint: '/api/v1/chat', status: 'success', duration_ms: duration, ...usage, created_at: Date.now() });
    return data;
  } catch (err) {
    clearTimeout(timer);
    const duration = Date.now() - start;
    const msg      = err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message;
    logsDB.updateLog(logId, { status: 'error', duration_ms: duration, error_message: msg });
    broadcastSSE('log:update', { id: logId, app: appName, endpoint: '/api/v1/chat', status: 'error', duration_ms: duration, error_message: msg, created_at: Date.now() });
    throw new Error(msg);
  }
}

// ── Fallback content ──────────────────────────────────────────────────────────
const FALLBACK_WARMUP = [
  'Tell me about your current job or daily routine.',
  'What communication situation in English feels difficult for you?',
  'Describe a recent challenge you solved at work.',
  'What goal would make you proud after 3 months of practice?'
];
const FALLBACK_GRAMMAR = [
  { q: 'By next month, I ____ here for two years.', a: 'will have worked', options: ['worked', 'will work', 'will have worked'], concept: 'Future Perfect' },
  { q: 'If I ____ more time, I would study every day.', a: 'had', options: ['have', 'had', 'would have'], concept: 'Second Conditional' },
  { q: 'She said she ____ the report the day before.', a: 'had finished', options: ['finished', 'has finished', 'had finished'], concept: 'Reported Speech / Past Perfect' },
  { q: 'The project ____ by an external team last year.', a: 'was completed', options: ['completed', 'was completed', 'is completed'], concept: 'Passive Voice' },
  { q: 'I need to speak ____ the manager about this.', a: 'to', options: ['to', 'with', 'for'], concept: 'Prepositions' },
  { q: 'He is good ____ explaining complex ideas.', a: 'at', options: ['in', 'at', 'on'], concept: 'Prepositions' },
  { q: 'We discussed ____ possibility of remote work.', a: 'the', options: ['a', 'an', 'the'], concept: 'Articles' },
  { q: 'If they had prepared better, they ____ missed the deadline.', a: 'would not have', options: ['would not', 'would not have', 'did not'], concept: 'Third Conditional' }
];
const FALLBACK_VOCAB = [
  { prompt: 'Please ____ me posted.', a: 'keep', meaningES: 'mantener informado', exampleEN: 'Please keep me posted on updates.' },
  { prompt: 'We need to ____ a decision.', a: 'make', meaningES: 'tomar una decision', exampleEN: 'We need to make a decision today.' },
  { prompt: 'Let us ____ this issue.', a: 'address', meaningES: 'abordar un tema', exampleEN: 'Let us address this in the meeting.' },
  { prompt: 'Could you ____ on this point?', a: 'elaborate', meaningES: 'desarrollar en detalle', exampleEN: 'Could you elaborate on your proposal?' },
  { prompt: 'This plan is not ____ enough.', a: 'feasible', meaningES: 'viable o realizable', exampleEN: 'This timeline is not feasible.' },
  { prompt: 'We reached a ____ solution.', a: 'mutually beneficial', meaningES: 'beneficioso para ambas partes', exampleEN: 'We found a mutually beneficial deal.' },
  { prompt: 'I want to ____ expectations.', a: 'set', meaningES: 'establecer', exampleEN: 'Let me set clear expectations.' },
  { prompt: 'The rollout was a complete ____.', a: 'success', meaningES: 'exito', exampleEN: 'The launch was a complete success.' },
  { prompt: 'Please ____ your feedback by Friday.', a: 'share', meaningES: 'compartir', exampleEN: 'Please share your thoughts by Friday.' },
  { prompt: 'Let us ____ resources efficiently.', a: 'allocate', meaningES: 'asignar recursos', exampleEN: 'We should allocate budget carefully.' },
  { prompt: 'We should ____ risks early.', a: 'mitigate', meaningES: 'minimizar un riesgo', exampleEN: 'We must mitigate risks before launch.' },
  { prompt: 'I totally ____ your point.', a: 'get', meaningES: 'entender (informal)', exampleEN: 'I get what you mean completely.' }
];
const FALLBACK_PRON = [
  'This is the thing they thought about.',
  'Very busy people build better habits.',
  'I need to leave this meeting at three.',
  'We linked all the ideas in one slide.',
  'I worked, called, and decided quickly.',
  'The deadline is Thursday, not Tuesday.',
  'Could you send the revised version?',
  'I would rather focus on the bigger picture.'
];
const FALLBACK_LISTENING_SCRIPT = 'Welcome back to the team excellence podcast. Today we explore how high-performing teams communicate under pressure. First, align strategic priorities before execution. Moreover, document trade-offs so stakeholders understand why decisions were made. In addition, challenge assumptions early through short review cycles. Build these habits consistently, and your collaboration will become both faster and more resilient.';
const FALLBACK_LISTENING_Q = [
  { q: 'What is the main topic?', options: ['Marketing campaigns', 'Team communication', 'Interview preparation'], a: 1 },
  { q: 'What should teams align first?', options: ['Budgets', 'Strategic priorities', 'Personal schedules'], a: 1 },
  { q: 'What should be documented?', options: ['Trade-offs', 'Salaries', 'Office locations'], a: 0 },
  { q: 'When should assumptions be challenged?', options: ['At the end', 'Only annually', 'Early, through short review cycles'], a: 2 },
  { q: 'What improves when habits are consistent?', options: ['Office size', 'Collaboration and resilience', 'Hardware'], a: 1 }
];
const FALLBACK_WRITING = 'Write a short professional email to request a deadline extension, keeping a polite and confident tone.';

// ── Content helpers ───────────────────────────────────────────────────────────
function ensureArray(val, fallback, minLen) {
  const arr = Array.isArray(val) && val.length >= minLen ? val : (Array.isArray(val) && val.length > 0 ? val : null);
  if (!arr) return fallback.slice();
  if (arr.length < minLen) return [...arr, ...fallback.slice(arr.length)];
  return arr;
}

function buildCompleteTeacherContent(rawContent) {
  const raw = rawContent && typeof rawContent === 'object' ? rawContent : {};

  const content = {
    warmupQuestions:     ensureArray(raw.warmupQuestions,     FALLBACK_WARMUP,       4).slice(0, 4),
    grammarItems:        ensureArray(raw.grammarItems,        FALLBACK_GRAMMAR,      8).slice(0, 8),
    writingPrompt:       (typeof raw.writingPrompt === 'string' && raw.writingPrompt.trim()) ? raw.writingPrompt.trim() : FALLBACK_WRITING,
    vocabItems:          ensureArray(raw.vocabItems,          FALLBACK_VOCAB,       12).slice(0, 12),
    pronunciationPhrases:ensureArray(raw.pronunciationPhrases,FALLBACK_PRON,         8).slice(0, 8),
    listeningScript:     (typeof raw.listeningScript === 'string' && raw.listeningScript.trim()) ? raw.listeningScript.trim() : FALLBACK_LISTENING_SCRIPT,
    listeningQuestions:  ensureArray(raw.listeningQuestions,  FALLBACK_LISTENING_Q,  5).slice(0, 5),
  };

  content.grammarItems = content.grammarItems.map((item) => {
    if (!item || typeof item.q !== 'string' || typeof item.a !== 'string' || !Array.isArray(item.options)) return FALLBACK_GRAMMAR[0];
    if (!item.options.includes(item.a)) {
      if (item.options.length < 2) item.options.push(item.a);
      else item.options[1] = item.a;
    }
    return item;
  });

  content.listeningQuestions = content.listeningQuestions.map((q, idx) => {
    if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length < 2) return FALLBACK_LISTENING_Q[idx] || FALLBACK_LISTENING_Q[0];
    const a = Number(q.a);
    q.a = (Number.isFinite(a) && a >= 0 && a < q.options.length) ? a : 0;
    return q;
  });

  content.vocabItems = content.vocabItems.map((v, idx) => {
    const fb = FALLBACK_VOCAB[idx] || FALLBACK_VOCAB[0];
    if (!v || typeof v.prompt !== 'string' || typeof v.a !== 'string') return fb;
    return {
      prompt:    v.prompt,
      a:         v.a,
      meaningES: v.meaningES || fb.meaningES,
      exampleEN: v.exampleEN || v.prompt.replace('____', v.a),
    };
  });

  return content;
}

// ── Router factory ────────────────────────────────────────────────────────────
module.exports = function createTeacherRouter({ broadcastSSE }) {
  const router = express.Router();

  // ── POST /api/teacher/generate-session ────────────────────────────────────
  router.post('/generate-session', async (req, res) => {
    const level         = String(req.body?.level         || 'C1').trim();
    const sessionNumber = String(req.body?.sessionNumber || '1').trim();

    const prompt1 = `You are an English teacher generating ${level} CEFR exercises for session #${sessionNumber}. Reply ONLY with a JSON object, no markdown.

JSON keys required:
"warmupQuestions": array of exactly 4 open speaking questions (strings).
"grammarItems": array of exactly 8 objects. Each: {"q":"sentence with ____ gap","a":"correct word or phrase","options":["wrong1","correct","wrong2"],"concept":"Grammar concept name, e.g. Future Perfect, Second Conditional, Third Conditional, Passive Voice, Reported Speech, Present Perfect, Articles, Prepositions"}. Mix: perfect tenses, conditionals, passive voice, articles, prepositions. The value of "a" MUST appear in "options".
"writingPrompt": one sentence describing a professional writing scenario.

Level: ${level}. Session: #${sessionNumber}. Generate unique, varied content. Reply with JSON only.`;

    const prompt2 = `You are an English teacher generating ${level} CEFR exercises for session #${sessionNumber}. Reply ONLY with a JSON object, no markdown.

JSON keys required:
"vocabItems": array of exactly 12 objects. Each: {"prompt":"Professional sentence with ____ gap","a":"collocation or phrasal verb that fills ____","meaningES":"Spanish translation of the word/phrase","exampleEN":"Natural English example sentence using the word"}. Use business English collocations appropriate for ${level}.
"pronunciationPhrases": array of exactly 8 English sentences targeting challenging phoneme contrasts (th sounds, v vs b, vowel length, consonant clusters, word stress). Each sentence should be 7-12 words.
"listeningScript": a single paragraph of 5-7 sentences, podcast/professional style, on a business or professional development topic. Must be self-contained so comprehension questions can be answered from it.
"listeningQuestions": array of exactly 5 objects. Each: {"q":"question string","options":["option0","option1","option2"],"a":N} where N is the 0-based index of the correct option. All answers must come directly from the listeningScript.

Level: ${level}. Session: #${sessionNumber}. Generate unique content. Reply with JSON only.`;

    let part1 = {};
    let part2 = {};
    const errors = [];

    try {
      part1 = parseLLMJson(extractLMText(await callLMLarge(prompt1, 'teacher', broadcastSSE)));
    } catch (e) { errors.push(`Call 1 failed: ${e.message}`); }

    try {
      part2 = parseLLMJson(extractLMText(await callLMLarge(prompt2, 'teacher', broadcastSSE)));
    } catch (e) { errors.push(`Call 2 failed: ${e.message}`); }

    const content  = buildCompleteTeacherContent({ ...part1, ...part2 });
    const response = { ok: true, content };
    if (errors.length) response.warnings = errors;
    res.json(response);
  });

  // ── POST /api/teacher/generate-section ───────────────────────────────────
  router.post('/generate-section', async (req, res) => {
    const level         = String(req.body?.level         || 'C1').trim();
    const sessionNumber = String(req.body?.sessionNumber || '1').trim();
    const section       = String(req.body?.section       || '').trim().toLowerCase();

    const validSections = new Set(['warmup', 'grammar', 'writing', 'vocab', 'pronunciation', 'listening']);
    if (!validSections.has(section)) {
      return res.status(400).json({ error: 'section must be one of: warmup, grammar, writing, vocab, pronunciation, listening' });
    }

    const sectionPrompts = {
      warmup:        `You are an English teacher generating ${level} CEFR warm-up speaking content for session #${sessionNumber}. Reply ONLY JSON with key "warmupQuestions" = array of exactly 4 open speaking questions.`,
      grammar:       `You are an English teacher generating ${level} CEFR grammar content for session #${sessionNumber}. Reply ONLY JSON with key "grammarItems" = array of exactly 8 objects: {"q":"sentence with ____ gap","a":"correct form","options":["wrong","correct","wrong"],"concept":"grammar concept"}. Ensure "a" appears in options.`,
      writing:       `You are an English teacher generating ${level} CEFR writing content for session #${sessionNumber}. Reply ONLY JSON with key "writingPrompt" = one professional writing prompt sentence.`,
      vocab:         `You are an English teacher generating ${level} CEFR vocabulary content for session #${sessionNumber}. Reply ONLY JSON with key "vocabItems" = array of exactly 12 objects: {"prompt":"sentence with ____ gap","a":"target collocation","meaningES":"spanish meaning","exampleEN":"english example"}.`,
      pronunciation: `You are an English teacher generating ${level} CEFR pronunciation content for session #${sessionNumber}. Reply ONLY JSON with key "pronunciationPhrases" = array of exactly 8 sentences (7-12 words each) targeting th sounds, v vs b, vowel length and stress.`,
      listening:     `You are an English teacher generating ${level} CEFR listening content for session #${sessionNumber}. Reply ONLY JSON with keys "listeningScript" (5-7 sentence paragraph) and "listeningQuestions" (exactly 5 objects with q/options/a where a is 0-based index).`
    };

    try {
      const raw    = extractLMText(await callLMTeacherSafe(sectionPrompts[section], 'teacher', broadcastSSE));
      const parsed = parseLLMJson(raw);

      let data;
      if (section === 'warmup') {
        data = ensureArray(parsed.warmupQuestions, FALLBACK_WARMUP, 4).slice(0, 4);
      } else if (section === 'grammar') {
        data = ensureArray(parsed.grammarItems, FALLBACK_GRAMMAR, 8).slice(0, 8).map((item) => {
          if (!item || typeof item.q !== 'string' || typeof item.a !== 'string' || !Array.isArray(item.options)) return FALLBACK_GRAMMAR[0];
          if (!item.options.includes(item.a)) {
            if (item.options.length < 2) item.options.push(item.a);
            else item.options[1] = item.a;
          }
          if (!item.concept) item.concept = 'Grammar structure';
          return item;
        });
      } else if (section === 'writing') {
        data = (typeof parsed.writingPrompt === 'string' && parsed.writingPrompt.trim()) ? parsed.writingPrompt.trim() : FALLBACK_WRITING;
      } else if (section === 'vocab') {
        data = ensureArray(parsed.vocabItems, FALLBACK_VOCAB, 12).slice(0, 12).map((v, idx) => {
          const fb = FALLBACK_VOCAB[idx] || FALLBACK_VOCAB[0];
          if (!v || typeof v.prompt !== 'string' || typeof v.a !== 'string') return fb;
          return { prompt: v.prompt, a: v.a, meaningES: v.meaningES || fb.meaningES, exampleEN: v.exampleEN || v.prompt.replace('____', v.a) };
        });
      } else if (section === 'pronunciation') {
        data = ensureArray(parsed.pronunciationPhrases, FALLBACK_PRON, 8).slice(0, 8);
      } else {
        const listeningScript    = (typeof parsed.listeningScript === 'string' && parsed.listeningScript.trim()) ? parsed.listeningScript.trim() : FALLBACK_LISTENING_SCRIPT;
        const listeningQuestions = ensureArray(parsed.listeningQuestions, FALLBACK_LISTENING_Q, 5).slice(0, 5).map((q, idx) => {
          if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length < 2) return FALLBACK_LISTENING_Q[idx] || FALLBACK_LISTENING_Q[0];
          const a = Number(q.a);
          q.a = (Number.isFinite(a) && a >= 0 && a < q.options.length) ? a : 0;
          return q;
        });
        data = { listeningScript, listeningQuestions };
      }

      return res.json({ ok: true, section, level, data });
    } catch (e) {
      const fallbackMap = {
        warmup:        FALLBACK_WARMUP.slice(0, 4),
        grammar:       FALLBACK_GRAMMAR.slice(0, 8),
        writing:       FALLBACK_WRITING,
        vocab:         FALLBACK_VOCAB.slice(0, 12),
        pronunciation: FALLBACK_PRON.slice(0, 8),
      };
      const fallbackData = fallbackMap[section] ?? { listeningScript: FALLBACK_LISTENING_SCRIPT, listeningQuestions: FALLBACK_LISTENING_Q.slice(0, 5) };
      return res.json({ ok: true, section, level, data: fallbackData, warning: e.message });
    }
  });

  // ── POST /api/teacher/content-packs ──────────────────────────────────────
  router.post('/content-packs', (req, res) => {
    try {
      const payload       = req.body && typeof req.body === 'object' ? req.body : {};
      const profileId     = String(payload.profileId     || '').trim();
      const packName      = String(payload.packName      || '').trim();
      const level         = String(payload.level         || '').trim();
      const sessionNumber = String(payload.sessionNumber || '').trim();
      const content       = payload.content && typeof payload.content === 'object' ? payload.content : null;

      if (!profileId)                       return res.status(400).json({ error: 'profileId is required' });
      if (profileId !== FIXED_PROFILE)      return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      if (!packName)                        return res.status(400).json({ error: 'packName is required' });
      if (!content)                         return res.status(400).json({ error: 'content object is required' });

      const saved = teacherDB.saveContentPack(profileId, packName, level, sessionNumber, buildCompleteTeacherContent(content));
      res.status(201).json({ ok: true, pack: saved });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/content-packs ───────────────────────────────────────
  router.get('/content-packs', (req, res) => {
    try {
      const profileId = String(req.query.profileId || '').trim();
      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      const packs = teacherDB.listContentPacks(profileId);
      res.json({ ok: true, packs, total: packs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/content-packs/:id ───────────────────────────────────
  router.get('/content-packs/:id', (req, res) => {
    try {
      const profileId = String(req.query.profileId || '').trim();
      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      const pack = teacherDB.getContentPackById(req.params.id, profileId);
      if (!pack) return res.status(404).json({ error: 'Content pack not found' });
      res.json({ ok: true, pack });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/maintenance/clear-saved-sessions ───────────────────
  router.post('/maintenance/clear-saved-sessions', (req, res) => {
    try {
      const profileId = String(req.body?.profileId || '').trim();
      if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      const result = teacherDB.clearAllData(profileId);
      res.json({ ok: true, cleared: result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/session-state ──────────────────────────────────────
  router.post('/session-state', (req, res) => {
    try {
      const payload = req.body?.sessionState && typeof req.body.sessionState === 'object'
        ? req.body.sessionState
        : req.body;

      const profileId     = String(payload?.profileId     || '').trim();
      const sessionNumber = String(payload?.sessionNumber || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      if (!sessionNumber)              return res.status(400).json({ error: 'sessionNumber is required' });

      const saved = teacherDB.upsertSessionState({ ...payload, profileId: FIXED_PROFILE });
      res.status(201).json({ ok: true, sessionState: saved });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/session-state ───────────────────────────────────────
  router.get('/session-state', (req, res) => {
    try {
      const profileId     = String(req.query.profileId     || '').trim();
      const sessionNumber = String(req.query.sessionNumber || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

      const state = sessionNumber
        ? teacherDB.getSessionState(FIXED_PROFILE, sessionNumber)
        : teacherDB.getLatestSessionState(FIXED_PROFILE);

      if (!state) return res.status(404).json({ error: 'Session state not found' });
      res.json({ ok: true, sessionState: state });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/vocabulary-cards ───────────────────────────────────
  router.post('/vocabulary-cards', (req, res) => {
    try {
      const payload = req.body?.vocabularyCards && typeof req.body.vocabularyCards === 'object'
        ? req.body.vocabularyCards
        : req.body;

      const profileId     = String(payload?.profileId     || '').trim();
      const sessionNumber = String(payload?.sessionNumber || '').trim();
      const cards         = Array.isArray(payload?.cards) ? payload.cards : [];

      if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });
      if (!sessionNumber)              return res.status(400).json({ error: 'sessionNumber is required' });
      if (!cards.length)               return res.status(400).json({ error: 'cards array is required' });

      const saved = teacherDB.upsertVocabularyCards(FIXED_PROFILE, sessionNumber, cards);
      res.status(201).json({ ok: true, vocabularyCards: saved });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/vocabulary-cards ────────────────────────────────────
  router.get('/vocabulary-cards', (req, res) => {
    try {
      const profileId     = String(req.query.profileId     || '').trim();
      const sessionNumber = String(req.query.sessionNumber || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

      const cards = sessionNumber
        ? teacherDB.getVocabularyCards(FIXED_PROFILE, sessionNumber)
        : teacherDB.getLatestVocabularyCards(FIXED_PROFILE);

      res.json({ ok: true, cards, total: cards.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/irregular-verbs/generate ───────────────────────────
  router.post('/irregular-verbs/generate', async (req, res) => {
    const payload   = req.body && typeof req.body === 'object' ? req.body : {};
    const profileId = String(payload.profileId || '').trim();
    const level     = String(payload.level     || 'B1').trim();

    if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
    if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

    const validLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);
    const safeLevel   = validLevels.has(level) ? level : 'B1';

    // Compute which master-list verbs are not yet in the database.
    // When the list is exhausted, wrap around so generation never dead-ends.
    const stored      = new Set(teacherDB.getExistingVerbBaseforms(FIXED_PROFILE));
    const unseen      = MASTER_VERB_LIST.filter((v) => !stored.has(v));
    const isWraparound = unseen.length === 0;
    const remaining   = isWraparound ? [...MASTER_VERB_LIST] : unseen;

    const targets = remaining.slice(0, 5);

    const prompt = `You are an English language teacher creating study materials.
Fill in the linguistic data for these ${targets.length} irregular English verbs:
${targets.map((v, i) => `${i + 1}. ${v}`).join('\n')}

Reply ONLY with a JSON array of exactly ${targets.length} objects. No markdown, no code blocks. Start with [ and end with ].

Required shape (use "break" as the example):
{"id":"v1","base_form":"break","forms":{"base":"break","past_simple":"broke","past_participle":"broken","third_person_singular":"breaks","present_participle":"breaking"},"tenses_usage":["Past Simple","Present Perfect","Present Simple"],"translation_es":["romper"],"pronunciation":{"uk":{"ipa":"/breɪk/","audio_url":"https://dictionary.cambridge.org/media/english/uk_pron/u/ukb/ukbre/ukbreak016.mp3"},"us":{"ipa":"/breɪk/","audio_url":"https://dictionary.cambridge.org/media/english/us_pron/b/br/break/break.mp3"}},"examples":[{"en":"She broke the glass.","es":"Ella rompió el vaso.","tense":"Past Simple"},{"en":"I have never broken a promise.","es":"Nunca he roto una promesa.","tense":"Present Perfect"}],"tags":["physical-action"]}

Generate entries for ALL ${targets.length} verbs listed above. Reply with JSON array only.`;

    try {
      const raw    = extractLMText(await callLMLarge(prompt, 'teacher', broadcastSSE));
      const parsed = parseLLMJson(raw);

      // Accept array at root, or object with any of several common key names
      let verbs = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.verbs)            ? parsed.verbs
        : Array.isArray(parsed.verb_list)        ? parsed.verb_list
        : Array.isArray(parsed.irregular_verbs)  ? parsed.irregular_verbs
        : Array.isArray(parsed.data)             ? parsed.data
        : (() => {
            const first = Object.values(parsed).find((v) => Array.isArray(v) && v.length);
            return first || [];
          })();

      // Normalise: keep only items that have at least base_form + forms
      verbs = verbs.filter((v) => v && typeof v.base_form === 'string' && v.base_form.trim() && v.forms && typeof v.forms === 'object')
        .map((v, i) => ({
          id:                  v.id || `v${i + 1}`,
          base_form:           v.base_form.trim().toLowerCase(),
          forms: {
            base:                    String(v.forms.base                    || v.base_form).trim(),
            past_simple:             String(v.forms.past_simple             || '').trim(),
            past_participle:         String(v.forms.past_participle         || '').trim(),
            third_person_singular:   String(v.forms.third_person_singular   || '').trim(),
            present_participle:      String(v.forms.present_participle      || '').trim(),
          },
          tenses_usage:        Array.isArray(v.tenses_usage)   ? v.tenses_usage   : [],
          translation_es:      Array.isArray(v.translation_es) ? v.translation_es : (v.translation_es ? [String(v.translation_es)] : []),
          pronunciation:       v.pronunciation && typeof v.pronunciation === 'object'
                                 ? v.pronunciation
                                 : { uk: { ipa: '', audio_url: '' }, us: { ipa: '', audio_url: '' } },
          examples:            Array.isArray(v.examples) ? v.examples : [],
          tags:                Array.isArray(v.tags)     ? v.tags     : [],
        }));

      if (!verbs.length) throw new Error('LLM returned no usable verbs — try again');

      const stamp     = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const batchName = `${safeLevel} · ${stamp}`;

      try {
        const saved = teacherDB.saveIrregularVerbs(FIXED_PROFILE, safeLevel, batchName, verbs, isWraparound);
        return res.status(201).json({ ok: true, batch: saved });
      } catch (dbErr) {
        if (dbErr.message === 'all_duplicates') {
          return res.status(409).json({ error: 'All generated verbs are already in the database. Try a different level or wait until more verbs are needed.' });
        }
        throw dbErr;
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/irregular-verbs ─────────────────────────────────────
  router.get('/irregular-verbs', (req, res) => {
    try {
      const profileId = String(req.query.profileId || '').trim();
      const id        = String(req.query.id        || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

      if (id) {
        const batch = teacherDB.getIrregularVerbBatch(id, FIXED_PROFILE);
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        return res.json({ ok: true, batch });
      }

      const batches   = teacherDB.listIrregularVerbBatches(FIXED_PROFILE);
      const latest    = batches.length ? teacherDB.getIrregularVerbBatch(batches[0].id, FIXED_PROFILE) : null;
      const allVerbs  = teacherDB.getAllIrregularVerbs(FIXED_PROFILE);
      const stored    = new Set(teacherDB.getExistingVerbBaseforms(FIXED_PROFILE));
      const unseenCount = MASTER_VERB_LIST.filter((v) => !stored.has(v)).length;
      return res.json({ ok: true, batches, latest, allVerbs, masterTotal: MASTER_VERB_LIST.length, unseenCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/regular-verbs/generate ─────────────────────────────
  router.post('/regular-verbs/generate', async (req, res) => {
    const payload   = req.body && typeof req.body === 'object' ? req.body : {};
    const profileId = String(payload.profileId || '').trim();
    const level     = String(payload.level     || 'B1').trim();

    if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
    if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

    const validLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);
    const safeLevel   = validLevels.has(level) ? level : 'B1';

    // Category-based: no fixed master list — the LLM generates verbs for the
    // chosen topic, passing recently-saved verbs in that category so it avoids repeats.
    const category  = String(payload.category || REGULAR_VERB_CATEGORIES[0]).trim();
    const safeCategory = REGULAR_VERB_CATEGORIES.includes(category) ? category : REGULAR_VERB_CATEGORIES[0];

    const recentInCategory = teacherDB.getRegularVerbBaseformsByCategory(FIXED_PROFILE, safeCategory);
    const avoidClause = recentInCategory.length
      ? `Do NOT include any of these already-saved verbs: ${recentInCategory.slice(0, 40).join(', ')}.`
      : '';

    const prompt = `You are an English language teacher creating study materials.
Generate exactly 5 regular English verbs at CEFR level ${safeLevel} related to the topic: "${safeCategory}".
${avoidClause}

Reply ONLY with a JSON array of exactly 5 objects. No markdown, no code blocks. Start with [ and end with ].

Required shape (use "discuss" as the example):
{"id":"v1","base_form":"discuss","forms":{"base":"discuss","past_simple":"discussed","past_participle":"discussed","third_person_singular":"discusses","present_participle":"discussing"},"tenses_usage":["Past Simple","Present Perfect","Present Simple"],"translation_es":["discutir","debatir"],"pronunciation":{"uk":{"ipa":"/dɪˈskʌs/","audio_url":""},"us":{"ipa":"/dɪˈskʌs/","audio_url":""}},"examples":[{"en":"We discussed the budget.","es":"Discutimos el presupuesto.","tense":"Past Simple"},{"en":"They have discussed this topic.","es":"Han discutido este tema.","tense":"Present Perfect"}],"tags":["${safeCategory.toLowerCase().replace(/[^a-z0-9]+/g,'-')}"]}

Generate 5 DIFFERENT regular verbs about "${safeCategory}" at level ${safeLevel}. Reply with JSON array only.`;

    try {
      const raw    = extractLMText(await callLMLarge(prompt, 'teacher', broadcastSSE));
      const parsed = parseLLMJson(raw);

      let verbs = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.verbs)          ? parsed.verbs
        : Array.isArray(parsed.verb_list)      ? parsed.verb_list
        : Array.isArray(parsed.regular_verbs)  ? parsed.regular_verbs
        : Array.isArray(parsed.data)           ? parsed.data
        : (() => { const first = Object.values(parsed).find((v) => Array.isArray(v) && v.length); return first || []; })();

      verbs = verbs.filter((v) => v && typeof v.base_form === 'string' && v.base_form.trim() && v.forms && typeof v.forms === 'object')
        .map((v, i) => ({
          id:             v.id || `v${i + 1}`,
          base_form:      v.base_form.trim().toLowerCase(),
          forms: {
            base:                  String(v.forms.base                  || v.base_form).trim(),
            past_simple:           String(v.forms.past_simple           || '').trim(),
            past_participle:       String(v.forms.past_participle       || '').trim(),
            third_person_singular: String(v.forms.third_person_singular || '').trim(),
            present_participle:    String(v.forms.present_participle    || '').trim(),
          },
          tenses_usage:   Array.isArray(v.tenses_usage)   ? v.tenses_usage   : [],
          translation_es: Array.isArray(v.translation_es) ? v.translation_es : (v.translation_es ? [String(v.translation_es)] : []),
          pronunciation:  v.pronunciation && typeof v.pronunciation === 'object'
                            ? v.pronunciation : { uk: { ipa: '', audio_url: '' }, us: { ipa: '', audio_url: '' } },
          examples:       Array.isArray(v.examples) ? v.examples : [],
          tags:           Array.isArray(v.tags)     ? v.tags     : [],
        }));

      if (!verbs.length) throw new Error('LLM returned no usable verbs — try again');

      const stamp     = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const batchName = `${safeCategory} · ${safeLevel} · ${stamp}`;

      try {
        const saved = teacherDB.saveRegularVerbs(FIXED_PROFILE, safeLevel, safeCategory, batchName, verbs);
        return res.status(201).json({ ok: true, batch: saved });
      } catch (dbErr) {
        if (dbErr.message === 'all_duplicates') {
          return res.status(409).json({ error: 'All generated verbs already exist. Try a different category or level.' });
        }
        throw dbErr;
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/regular-verbs ───────────────────────────────────────
  router.get('/regular-verbs', (req, res) => {
    try {
      const profileId = String(req.query.profileId || '').trim();
      const id        = String(req.query.id        || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

      if (id) {
        const batch = teacherDB.getRegularVerbBatch(id, FIXED_PROFILE);
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        return res.json({ ok: true, batch });
      }

      const batches      = teacherDB.listRegularVerbBatches(FIXED_PROFILE);
      const latest       = batches.length ? teacherDB.getRegularVerbBatch(batches[0].id, FIXED_PROFILE) : null;
      const allVerbs     = teacherDB.getAllRegularVerbs(FIXED_PROFILE);
      const categoryStats = teacherDB.getRegularVerbCategoryStats(FIXED_PROFILE);
      return res.json({ ok: true, batches, latest, allVerbs, categories: REGULAR_VERB_CATEGORIES, categoryStats, totalInDB: allVerbs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/teacher/phrasal-verbs/generate ─────────────────────────────
  router.post('/phrasal-verbs/generate', async (req, res) => {
    const payload   = req.body && typeof req.body === 'object' ? req.body : {};
    const profileId = String(payload.profileId || '').trim();
    const level     = String(payload.level     || 'B1').trim();

    if (!profileId)                  return res.status(400).json({ error: 'profileId is required' });
    if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

    const validLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);
    const safeLevel   = validLevels.has(level) ? level : 'B1';

    // Category-based: no fixed master list — the LLM generates phrasal verbs for
    // the chosen topic, passing recently-saved verbs in that category to avoid repeats.
    const category    = String(payload.category || PHRASAL_VERB_CATEGORIES[0]).trim();
    const safeCategory = PHRASAL_VERB_CATEGORIES.includes(category) ? category : PHRASAL_VERB_CATEGORIES[0];

    const recentInCategory = teacherDB.getPhrasalVerbBaseformsByCategory(FIXED_PROFILE, safeCategory);
    const avoidClause = recentInCategory.length
      ? `Do NOT include any of these already-saved phrasal verbs: ${recentInCategory.slice(0, 40).join(', ')}.`
      : '';

    const prompt = `You are an English language teacher creating study materials.
Generate exactly 5 English phrasal verbs at CEFR level ${safeLevel} related to the topic: "${safeCategory}".
${avoidClause}

Reply ONLY with a JSON array of exactly 5 objects. No markdown, no code blocks. Start with [ and end with ].

Required shape (use "give up" as the example):
{"id":"v1","base_form":"give up","verb":"give","particle":"up","type":"separable","forms":{"base":"give up","past_simple":"gave up","past_participle":"given up","third_person_singular":"gives up","present_participle":"giving up"},"tenses_usage":["Past Simple","Present Perfect","Present Simple"],"translation_es":["rendirse","abandonar"],"pronunciation":{"uk":{"ipa":"/ɡɪv ʌp/","audio_url":""},"us":{"ipa":"/ɡɪv ʌp/","audio_url":""}},"examples":[{"en":"She gave up smoking last year.","es":"Ella dejó de fumar el año pasado.","tense":"Past Simple"},{"en":"I have given up trying to fix it.","es":"He renunciado a intentar arreglarlo.","tense":"Present Perfect"}],"tags":["${safeCategory.toLowerCase().replace(/[^a-z0-9]+/g,'-')}"]}

The "type" field must be one of: "separable", "inseparable", or "intransitive".
Generate 5 DIFFERENT phrasal verbs about "${safeCategory}" at level ${safeLevel}. Reply with JSON array only.`;

    try {
      const raw    = extractLMText(await callLMLarge(prompt, 'teacher', broadcastSSE));
      const parsed = parseLLMJson(raw);

      let verbs = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.verbs)         ? parsed.verbs
        : Array.isArray(parsed.verb_list)     ? parsed.verb_list
        : Array.isArray(parsed.phrasal_verbs) ? parsed.phrasal_verbs
        : Array.isArray(parsed.data)          ? parsed.data
        : (() => {
            const first = Object.values(parsed).find((v) => Array.isArray(v) && v.length);
            return first || [];
          })();

      verbs = verbs.filter((v) => v && typeof v.base_form === 'string' && v.base_form.trim() && v.forms && typeof v.forms === 'object')
        .map((v, i) => ({
          id:             v.id || `v${i + 1}`,
          base_form:      v.base_form.trim().toLowerCase(),
          verb:           String(v.verb           || '').trim(),
          particle:       String(v.particle       || '').trim(),
          type:           String(v.type           || '').trim(),
          forms: {
            base:                  String(v.forms.base                    || v.base_form).trim(),
            past_simple:           String(v.forms.past_simple             || '').trim(),
            past_participle:       String(v.forms.past_participle         || '').trim(),
            third_person_singular: String(v.forms.third_person_singular   || '').trim(),
            present_participle:    String(v.forms.present_participle      || '').trim(),
          },
          tenses_usage:   Array.isArray(v.tenses_usage)   ? v.tenses_usage   : [],
          translation_es: Array.isArray(v.translation_es) ? v.translation_es : (v.translation_es ? [String(v.translation_es)] : []),
          pronunciation:  v.pronunciation && typeof v.pronunciation === 'object'
                            ? v.pronunciation
                            : { uk: { ipa: '', audio_url: '' }, us: { ipa: '', audio_url: '' } },
          examples:       Array.isArray(v.examples) ? v.examples : [],
          tags:           Array.isArray(v.tags)     ? v.tags     : [],
        }));

      if (!verbs.length) throw new Error('LLM returned no usable phrasal verbs — try again');

      const stamp     = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const batchName = `${safeCategory} · ${safeLevel} · ${stamp}`;

      try {
        const saved = teacherDB.savePhrasalVerbs(FIXED_PROFILE, safeLevel, safeCategory, batchName, verbs);
        return res.status(201).json({ ok: true, batch: saved });
      } catch (dbErr) {
        if (dbErr.message === 'all_duplicates') {
          return res.status(409).json({ error: 'All generated phrasal verbs already exist. Try a different category or level.' });
        }
        throw dbErr;
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/teacher/phrasal-verbs ───────────────────────────────────────
  router.get('/phrasal-verbs', (req, res) => {
    try {
      const profileId = String(req.query.profileId || '').trim();
      const id        = String(req.query.id        || '').trim();

      if (!profileId)                  return res.status(400).json({ error: 'profileId query param is required' });
      if (profileId !== FIXED_PROFILE) return res.status(403).json({ error: `profileId must be ${FIXED_PROFILE}` });

      if (id) {
        const batch = teacherDB.getPhrasalVerbBatch(id, FIXED_PROFILE);
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        return res.json({ ok: true, batch });
      }

      const batches       = teacherDB.listPhrasalVerbBatches(FIXED_PROFILE);
      const latest        = batches.length ? teacherDB.getPhrasalVerbBatch(batches[0].id, FIXED_PROFILE) : null;
      const allVerbs      = teacherDB.getAllPhrasalVerbs(FIXED_PROFILE);
      const categoryStats = teacherDB.getPhrasalVerbCategoryStats(FIXED_PROFILE);
      return res.json({ ok: true, batches, latest, allVerbs, categories: PHRASAL_VERB_CATEGORIES, categoryStats, totalInDB: allVerbs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
