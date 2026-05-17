
const API_STATE = '/api/teacher/session-state';
const API_VOCAB_CARDS = '/api/teacher/vocabulary-cards';
const API_GENERATE = '/api/teacher/generate-session';
const API_GENERATE_SECTION = '/api/teacher/generate-section';
const API_CONTENT_PACKS = '/api/teacher/content-packs';
const MAX_RECORDING_MS = 120000;
const FIXED_PROFILE_ID = 'daniel';
const PROGRESSIVE_LEVELS = ['B2', 'B2+', 'C1-lite', 'C1'];
const SECTION_ORDER = ['warmup', 'grammar', 'writing', 'vocab', 'pronunciation', 'listening'];

let warmupQuestions = [
  'Tell me about your current job or daily routine.',
  'What communication situation in English feels difficult for you?',
  'Describe a recent challenge you solved.',
  'What result would make you proud after 3 months of practice?'
];

let grammarItems = [
  { q: 'By next month, I ____ here for two years.', a: 'will have worked', options: ['worked', 'will work', 'will have worked'] },
  { q: 'If I ____ more time, I would study every day.', a: 'had', options: ['have', 'had', 'would have'] },
  { q: 'She said she ____ the report the day before.', a: 'had finished', options: ['finished', 'has finished', 'had finished'] },
  { q: 'The project ____ by an external team last year.', a: 'was completed', options: ['completed', 'was completed', 'is completed'] },
  { q: 'I need to speak ____ the manager about this issue.', a: 'to', options: ['to', 'with', 'for'] },
  { q: 'He is good ____ explaining complex ideas.', a: 'at', options: ['in', 'at', 'on'] },
  { q: 'We discussed ____ possibility of remote work.', a: 'the', options: ['a', 'an', 'the'] },
  { q: 'If they had prepared better, they ____ missed the deadline.', a: 'would not have', options: ['would not', 'would not have', 'did not'] }
];

let vocabItems = [
  { prompt: 'Please ____ me posted.', a: 'keep' },
  { prompt: 'We need to ____ a decision.', a: 'make' },
  { prompt: 'Let us ____ this issue.', a: 'address' },
  { prompt: 'Could you ____ on this point?', a: 'elaborate' },
  { prompt: 'This plan is not ____ enough.', a: 'feasible' },
  { prompt: 'We reached a ____ solution.', a: 'mutually beneficial' },
  { prompt: 'I want to ____ expectations.', a: 'set' },
  { prompt: 'The rollout was a complete ____.', a: 'success' },
  { prompt: 'Please ____ your feedback by Friday.', a: 'share' },
  { prompt: 'Let us ____ resources efficiently.', a: 'allocate' },
  { prompt: 'We should ____ risks early.', a: 'mitigate' },
  { prompt: 'I totally ____ your point.', a: 'get' }
];

let vocabWordBank = [
  'keep',
  'make',
  'address',
  'elaborate',
  'feasible',
  'mutually beneficial',
  'set',
  'success',
  'share',
  'allocate',
  'mitigate',
  'get'
];

let vocabCardDictionary = {
  keep: { meaningES: 'mantener o conservar', exampleEN: 'Please keep me posted on any updates.' },
  make: { meaningES: 'hacer o tomar (una decision)', exampleEN: 'We need to make a decision before noon.' },
  address: { meaningES: 'abordar un tema o problema', exampleEN: 'Let us address this issue in today\'s meeting.' },
  elaborate: { meaningES: 'desarrollar una idea con mas detalle', exampleEN: 'Could you elaborate on your proposal?' },
  feasible: { meaningES: 'viable o realizable', exampleEN: 'This timeline is feasible if we reduce scope.' },
  'mutually beneficial': { meaningES: 'beneficioso para ambas partes', exampleEN: 'We reached a mutually beneficial solution.' },
  set: { meaningES: 'establecer', exampleEN: 'I want to set clear expectations for the team.' },
  success: { meaningES: 'exito', exampleEN: 'The rollout was a complete success.' },
  share: { meaningES: 'compartir', exampleEN: 'Please share your feedback by Friday.' },
  allocate: { meaningES: 'asignar recursos', exampleEN: 'Let us allocate resources efficiently.' },
  mitigate: { meaningES: 'reducir o minimizar un riesgo', exampleEN: 'We should mitigate risks early.' },
  get: { meaningES: 'entender en contexto informal', exampleEN: 'I totally get your point.' },
};

let pronunciationPhrases = [
  'This is the thing they thought about.',
  'Very busy people build better habits.',
  'I need to leave this meeting at three.',
  'We linked all the ideas in one slide.',
  'I worked, called, and decided quickly.',
  'The deadline is Thursday, not Tuesday.',
  'Could you send the revised version?',
  'I would rather focus on the bigger picture.'
];

let listeningScript = 'Welcome back to the weekly productivity podcast. Today we are talking about communication habits that make teams stronger. First, clarify outcomes before starting tasks. Moreover, summarize decisions in writing after each meeting. Finally, check assumptions early, rather than waiting for problems to grow. If you build these habits, collaboration becomes smoother and trust grows faster.';

let listeningQuestions = [
  { q: 'What is the main topic?', options: ['Marketing campaigns', 'Communication habits', 'Interview preparation'], a: 1 },
  { q: 'What should teams clarify first?', options: ['Outcomes', 'Budgets', 'Personal schedules'], a: 0 },
  { q: 'What should happen after meetings?', options: ['Cancel follow-up', 'Summarize decisions in writing', 'Switch tools'], a: 1 },
  { q: 'When should assumptions be checked?', options: ['At the end', 'Only weekly', 'Early'], a: 2 },
  { q: 'What improves faster according to the audio?', options: ['Trust', 'Hardware', 'Office size'], a: 0 }
];

let writingPrompt = 'Write a short professional email to request a deadline extension, keeping a polite and confident tone.';

const state = {
  profileId: FIXED_PROFILE_ID,
  sessionNumber: '',
  cefrLevelEstimate: 'C1',
  mainGoal: '',
  difficultyLevel: 'C1-lite',
  progressIndex: 0,
  sessionHistoryCount: 0,
  currentStep: 0,
  scores: {
    vocab: 0,
    grammar: 0,
    writing: 0,
    pronunciation: 0,
    listening: 0,
    fluency: 0
  },
  warmupTranscripts: ['', '', '', ''],
  pronunciationTranscripts: Array(pronunciationPhrases.length).fill(''),
  recurringErrors: [],
  newVocabulary: [],
  pronunciationTargets: [],
  nextHomework: [],
  writingText: '',
  writingCorrection: '',
  listeningAnswers: [],
  learningLog: '',
  vocabularyCards: [],
  sessionState: null,
  settings: {
    targetLevel: 'C1-lite',
    generationMode: 'chunked',
    llmAllSections: true,
    progressiveLevelIndex: 0,
    progressiveSectionIndex: 0,
  },
  selectedContentPackId: '',
  contentPacks: [],
  selectedContentPack: null,
};

function createEmptyScores() {
  return {
    vocab: 0,
    grammar: 0,
    writing: 0,
    pronunciation: 0,
    listening: 0,
    fluency: 0
  };
}

function resetSessionData() {
  state.currentStep = 0;
  state.scores = createEmptyScores();
  state.warmupTranscripts = ['', '', '', ''];
  state.pronunciationTranscripts = Array(pronunciationPhrases.length).fill('');
  state.recurringErrors = [];
  state.newVocabulary = [];
  state.pronunciationTargets = [];
  state.nextHomework = [];
  state.writingText = '';
  state.writingCorrection = '';
  state.listeningAnswers = [];
  state.learningLog = '';
  state.vocabularyCards = [];
  state.sessionState = null;
  renderVocabularyCardDeck([], 'Session reset. New vocabulary cards will be generated for this session.');
}

function computeAverageScore(scores) {
  const vals = Object.values(scores || {}).map((x) => Number(x) || 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function recalcDifficultyFromPerformance() {
  if (state.progressIndex === 0 && computeAverageScore(state.scores) === 0) {
    state.difficultyLevel = 'C1-lite';
    state.cefrLevelEstimate = 'C1';
    return;
  }

  const avg = computeAverageScore(state.scores);
  const progressBoost = Math.min(1.2, state.progressIndex * 0.2);
  const effective = avg + progressBoost;

  if (effective >= 8.7) {
    state.difficultyLevel = 'C1-lite';
    state.cefrLevelEstimate = 'C1';
    return;
  }
  if (effective >= 7.4) {
    state.difficultyLevel = 'B2+';
    state.cefrLevelEstimate = 'B2+';
    return;
  }
  if (effective >= 6.0) {
    state.difficultyLevel = 'B2';
    state.cefrLevelEstimate = 'B2';
    return;
  }
  state.difficultyLevel = 'B1+ reinforcement';
  state.cefrLevelEstimate = 'B1+';
}

function currentListeningScript() {
  return listeningScript;
}

function applyGeneratedSection(section, data) {
  if (section === 'warmup' && Array.isArray(data)) {
    warmupQuestions = data.slice(0, 4);
    return;
  }
  if (section === 'grammar' && Array.isArray(data)) {
    grammarItems = data.slice(0, 8);
    return;
  }
  if (section === 'writing' && typeof data === 'string') {
    writingPrompt = data;
    return;
  }
  if (section === 'vocab' && Array.isArray(data)) {
    vocabItems = data.slice(0, 12);
    vocabWordBank = vocabItems.map((v) => v.a);
    vocabCardDictionary = {};
    vocabItems.forEach((v) => {
      vocabCardDictionary[v.a] = {
        meaningES: v.meaningES || '',
        exampleEN: v.exampleEN || v.prompt.replace('____', v.a),
      };
    });
    return;
  }
  if (section === 'pronunciation' && Array.isArray(data)) {
    pronunciationPhrases = data.slice(0, 8);
    state.pronunciationTranscripts = Array(pronunciationPhrases.length).fill('');
    return;
  }
  if (section === 'listening' && data && typeof data === 'object') {
    listeningScript = typeof data.listeningScript === 'string' ? data.listeningScript : listeningScript;
    listeningQuestions = Array.isArray(data.listeningQuestions) ? data.listeningQuestions.slice(0, 5) : listeningQuestions;
  }
}

function getCurrentContentPayload() {
  return {
    warmupQuestions: warmupQuestions.slice(0, 4),
    grammarItems: grammarItems.slice(0, 8),
    writingPrompt,
    vocabItems: vocabItems.slice(0, 12),
    pronunciationPhrases: pronunciationPhrases.slice(0, 8),
    listeningScript,
    listeningQuestions: listeningQuestions.slice(0, 5),
  };
}

function applyContentPack(content) {
  if (!content || typeof content !== 'object') return;
  if (Array.isArray(content.warmupQuestions)) {
    warmupQuestions = content.warmupQuestions
      .map((q) => String(q || '').trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  if (Array.isArray(content.grammarItems)) {
    grammarItems = content.grammarItems.slice(0, 8).map((it) => {
      const q = String(it?.q || '').trim();
      const a = String(it?.a || '').trim();
      const options = Array.isArray(it?.options) ? it.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
      if (!q || !a || options.length < 2) return null;
      if (!options.includes(a)) options.splice(Math.min(1, options.length), 0, a);
      return { ...it, q, a, options: options.slice(0, 3) };
    }).filter(Boolean);
  }
  if (typeof content.writingPrompt === 'string') writingPrompt = content.writingPrompt;
  if (Array.isArray(content.vocabItems)) {
    vocabItems = content.vocabItems.slice(0, 12).map((v, idx) => {
      const safeA = String(v?.a || '').trim() || `term-${idx + 1}`;
      const safePrompt = String(v?.prompt || '').trim() || `Use ${safeA} in context: ____.`;
      const safeMeaning = String(v?.meaningES || '').trim();
      const safeExample = String(v?.exampleEN || '').trim() || (safePrompt.includes('____') ? safePrompt.replace('____', safeA) : `${safePrompt} ${safeA}`);
      return { prompt: safePrompt, a: safeA, meaningES: safeMeaning, exampleEN: safeExample };
    });
    vocabWordBank = vocabItems.map((v) => v.a);
    vocabCardDictionary = {};
    vocabItems.forEach((v) => {
      vocabCardDictionary[v.a] = {
        meaningES: v.meaningES || '',
        exampleEN: v.exampleEN || (v.prompt.includes('____') ? v.prompt.replace('____', v.a) : `${v.prompt} ${v.a}`),
      };
    });
  }
  if (Array.isArray(content.pronunciationPhrases)) {
    pronunciationPhrases = content.pronunciationPhrases.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 8);
    state.pronunciationTranscripts = Array(pronunciationPhrases.length).fill('');
  }
  if (typeof content.listeningScript === 'string') listeningScript = content.listeningScript;
  if (Array.isArray(content.listeningQuestions)) {
    listeningQuestions = content.listeningQuestions.slice(0, 5).map((q) => {
      const qq = String(q?.q || '').trim();
      const options = Array.isArray(q?.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
      const aNum = Number(q?.a);
      const a = Number.isFinite(aNum) && aNum >= 0 && aNum < options.length ? aNum : 0;
      if (!qq || options.length < 2) return null;
      return { q: qq, options: options.slice(0, 3), a };
    }).filter(Boolean);
  }

  // Final guardrails so session can always start
  if (!Array.isArray(warmupQuestions) || warmupQuestions.length < 4) {
    warmupQuestions = [
      'Tell me about your current role and responsibilities.',
      'What communication challenge do you face most often?',
      'Describe a recent work situation that required problem-solving.',
      'What is your English goal for this month?'
    ];
  }
}

async function saveGeneratedContentPack(packNameOverride) {
  const level = state.settings.targetLevel || state.difficultyLevel || 'C1-lite';
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const packName = packNameOverride || `${level} · Session ${state.sessionNumber || '1'} · ${stamp}`;
  const payload = {
    profileId: FIXED_PROFILE_ID,
    packName,
    level,
    sessionNumber: String(state.sessionNumber || '1'),
    content: getCurrentContentPayload(),
  };

  const res = await fetch(API_CONTENT_PACKS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  await loadContentPackOptions(data?.pack?.id ? String(data.pack.id) : '');
  return data.pack;
}

async function loadContentPackOptions(selectId) {
  const select = document.getElementById('content-pack-select');
  if (!select) return;

  select.innerHTML = `<option value="">Loading packs...</option>`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  let data;
  try {
    res = await fetch(`${API_CONTENT_PACKS}?profileId=${encodeURIComponent(FIXED_PROFILE_ID)}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    data = await res.json().catch(() => ({}));
  } catch (e) {
    clearTimeout(timeoutId);
    select.innerHTML = `<option value="">Could not load packs (timeout/network). Click Refresh packs.</option>`;
    return;
  }

  if (!res.ok || !data.ok) {
    select.innerHTML = `<option value="">Could not load packs. Click Refresh packs.</option>`;
    return;
  }

  state.contentPacks = Array.isArray(data.packs) ? data.packs : [];
  if (!state.contentPacks.length) {
    select.innerHTML = `<option value="">No saved packs yet (generate from Settings)</option>`;
    state.selectedContentPackId = '';
    return;
  }

  select.innerHTML = `<option value="">Select a saved pack</option>` +
    state.contentPacks.map((p) => {
      const label = `${p.packName} | ${p.level || '-'} | S${p.sessionNumber || '-'} | #${p.id}`;
      return `<option value="${escapeAttr(String(p.id))}">${escapeHtml(label)}</option>`;
    }).join('');

  const defaultId = selectId || state.selectedContentPackId || String(state.contentPacks[0].id);
  if (defaultId) {
    select.value = defaultId;
    state.selectedContentPackId = defaultId;
    await previewSelectedContentPack(defaultId);
  }
}

async function loadSelectedContentPack() {
  const select = document.getElementById('content-pack-select');
  const selectedId = String(select?.value || state.selectedContentPackId || '').trim();
  if (!selectedId) throw new Error('Select a saved content pack first');

  if (state.selectedContentPack && String(state.selectedContentPack.id) === selectedId) {
    state.selectedContentPackId = selectedId;
    applyContentPack(state.selectedContentPack.content || {});
    return state.selectedContentPack;
  }

  const res = await fetch(`${API_CONTENT_PACKS}/${encodeURIComponent(selectedId)}?profileId=${encodeURIComponent(FIXED_PROFILE_ID)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.pack) throw new Error(data.error || `HTTP ${res.status}`);
  state.selectedContentPackId = selectedId;
  state.selectedContentPack = data.pack;
  applyContentPack(data.pack.content);
  return data.pack;
}

async function previewSelectedContentPack(packId) {
  const selectedId = String(packId || state.selectedContentPackId || '').trim();
  if (!selectedId) return;

  const ws = document.getElementById('workspace');
  if (!ws) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  let data;
  try {
    res = await fetch(`${API_CONTENT_PACKS}/${encodeURIComponent(selectedId)}?profileId=${encodeURIComponent(FIXED_PROFILE_ID)}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    data = await res.json().catch(() => ({}));
  } catch (_) {
    clearTimeout(timeoutId);
    return;
  }
  if (!res.ok || !data.ok || !data.pack) return;

  const c = data.pack.content || {};
  state.selectedContentPack = data.pack;
  const counts = {
    warmup: Array.isArray(c.warmupQuestions) ? c.warmupQuestions.length : 0,
    grammar: Array.isArray(c.grammarItems) ? c.grammarItems.length : 0,
    vocab: Array.isArray(c.vocabItems) ? c.vocabItems.length : 0,
    pronunciation: Array.isArray(c.pronunciationPhrases) ? c.pronunciationPhrases.length : 0,
    listeningQ: Array.isArray(c.listeningQuestions) ? c.listeningQuestions.length : 0,
  };

  ws.innerHTML = `
    <div class="card">
      <h3>Ready to Start — Selected Content Pack</h3>
      <p><strong>${escapeHtml(data.pack.packName || `Pack #${selectedId}`)}</strong> · Level: ${escapeHtml(data.pack.level || '-')} · Session ref: ${escapeHtml(data.pack.sessionNumber || '-')}</p>
      <ul class="bullet-list">
        <li>Warm-up questions: ${counts.warmup}</li>
        <li>Grammar items: ${counts.grammar}</li>
        <li>Vocabulary items: ${counts.vocab}</li>
        <li>Pronunciation phrases: ${counts.pronunciation}</li>
        <li>Listening questions: ${counts.listeningQ}</li>
      </ul>
      <div class="inline-actions">
        <button class="btn-primary" onclick="startSession(true)">Start Session with this pack</button>
      </div>
    </div>
  `;
}

async function generateSectionContent(section, levelOverride) {
  const level = levelOverride || state.settings.targetLevel || state.difficultyLevel;
  const res = await fetch(API_GENERATE_SECTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section,
      level,
      sessionNumber: state.sessionNumber || '1',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  applyGeneratedSection(section, data.data);
  return data;
}

async function generateSessionContentChunked(levelOverride) {
  const level = levelOverride || state.settings.targetLevel || state.difficultyLevel;
  const ws = document.getElementById('workspace');
  ws.innerHTML = `
    <div class="card">
      <h3>Generating content (timeout-safe mode)…</h3>
      <p style="margin:6px 0;color:var(--muted)">Level: ${escapeHtml(level)} · Session #${escapeHtml(state.sessionNumber || '1')}</p>
      <ul id="chunk-progress" class="bullet-list"></ul>
    </div>
  `;

  const progressEl = document.getElementById('chunk-progress');
  let warnings = 0;

  for (const section of SECTION_ORDER) {
    progressEl.innerHTML += `<li>Generating ${escapeHtml(section)}…</li>`;
    try {
      const result = await generateSectionContent(section, level);
      if (result.warning) warnings++;
      progressEl.innerHTML += `<li><span class="good">Done:</span> ${escapeHtml(section)}${result.warning ? ` <span style="color:#c08020">(fallback: ${escapeHtml(result.warning)})</span>` : ''}</li>`;
    } catch (e) {
      progressEl.innerHTML += `<li><span class="bad">Error:</span> ${escapeHtml(section)} — ${escapeHtml(e.message)}</li>`;
      return false;
    }
  }

  if (warnings > 0) {
    const notice = document.getElementById('setup-notice');
    if (notice) notice.textContent = `Content generated with ${warnings} fallback section(s).`;
  }

  try {
    const saved = await saveGeneratedContentPack();
    const notice = document.getElementById('setup-notice');
    if (notice) notice.textContent = `Generated and saved in SQLite as pack #${saved.id}.`;
  } catch (e) {
    const notice = document.getElementById('setup-notice');
    if (notice) notice.textContent = `Generated, but could not save pack: ${e.message}`;
  }

  return true;
}

async function generateNextProgressiveChunk() {
  const lIdx = state.settings.progressiveLevelIndex;
  const sIdx = state.settings.progressiveSectionIndex;

  if (lIdx >= PROGRESSIVE_LEVELS.length) {
    const progress = document.getElementById('settings-progress');
    if (progress) progress.textContent = 'Progressive generation complete: B2 -> C1 finished.';
    return;
  }

  const level = PROGRESSIVE_LEVELS[lIdx];
  const section = SECTION_ORDER[sIdx];
  const progress = document.getElementById('settings-progress');
  if (progress) progress.textContent = `Generating ${section} at ${level}...`;

  try {
    const result = await generateSectionContent(section, level);
    if (progress) {
      progress.textContent = result.warning
        ? `Generated ${section} at ${level} (fallback used: ${result.warning}).`
        : `Generated ${section} at ${level}.`;
    }
  } catch (e) {
    if (progress) progress.textContent = `Failed on ${section} at ${level}: ${e.message}`;
    return;
  }

  state.settings.progressiveSectionIndex += 1;
  if (state.settings.progressiveSectionIndex >= SECTION_ORDER.length) {
    state.settings.progressiveSectionIndex = 0;
    state.settings.progressiveLevelIndex += 1;
  }

  const notice = document.getElementById('setup-notice');
  if (notice) {
    const nextLevel = PROGRESSIVE_LEVELS[state.settings.progressiveLevelIndex] || 'Completed';
    const nextSection = SECTION_ORDER[state.settings.progressiveSectionIndex] || '-';
    notice.textContent = `Progressive generation: next chunk ${nextLevel} / ${nextSection}.`;
  }
}

function openSettingsScreen() {
  const ws = document.getElementById('workspace');
  ws.innerHTML = `
    <div class="card">
      <h3>Teacher Settings</h3>
      <p>Configure LLM content generation and use progressive generation from B2 to C1.</p>

      <div class="row">
        <label for="settings-target-level">Target level for session generation</label>
        <select id="settings-target-level">
          ${PROGRESSIVE_LEVELS.map((l) => `<option value="${escapeAttr(l)}" ${state.settings.targetLevel === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
        </select>
      </div>

      <div class="row">
        <label for="settings-generation-mode">Generation mode</label>
        <select id="settings-generation-mode">
          <option value="chunked" ${state.settings.generationMode === 'chunked' ? 'selected' : ''}>Chunked (timeout-safe, recommended)</option>
          <option value="full" ${state.settings.generationMode === 'full' ? 'selected' : ''}>Full (single request)</option>
        </select>
      </div>

      <div class="row">
        <label><input type="checkbox" id="settings-llm-all" ${state.settings.llmAllSections ? 'checked' : ''}> Ask LLM for all sections</label>
      </div>

      <div class="inline-actions">
        <button class="btn-primary" onclick="saveSettingsFromScreen()">Save settings</button>
        <button class="btn-secondary" onclick="generateSessionContentChunked().then(ok => { if(ok) buildWarmupStep(); })">Generate all sections now (safe)</button>
        <button class="btn-warn" onclick="generateNextProgressiveChunk()">Generate next chunk B2 -> C1</button>
        <button class="btn-secondary" onclick="previewSettingsCurrentContent()">Preview current content</button>
        <button class="btn-secondary" onclick="previewSettingsSelectedPack()">Preview selected saved pack</button>
        <button class="btn-primary" onclick="usePreviewPackForSession()">Use this preview pack for next start</button>
      </div>

      <div id="settings-progress" class="notice" style="margin-top:8px">
        Progressive pointer: ${escapeHtml(PROGRESSIVE_LEVELS[state.settings.progressiveLevelIndex] || 'Completed')} / ${escapeHtml(SECTION_ORDER[state.settings.progressiveSectionIndex] || '-')}
      </div>

      <div id="settings-preview" class="notice" style="margin-top:10px">Click "Preview current content" or "Preview selected saved pack".</div>
    </div>
  `;

  previewSettingsCurrentContent();
}

function renderSettingsPreview(content, title) {
  const host = document.getElementById('settings-preview');
  if (!host) return;
  const c = content && typeof content === 'object' ? content : {};

  const warmup = Array.isArray(c.warmupQuestions) ? c.warmupQuestions.slice(0, 4) : [];
  const grammar = Array.isArray(c.grammarItems) ? c.grammarItems.slice(0, 2) : [];
  const vocab = Array.isArray(c.vocabItems) ? c.vocabItems.slice(0, 3) : [];
  const pron = Array.isArray(c.pronunciationPhrases) ? c.pronunciationPhrases.slice(0, 2) : [];
  const listenQ = Array.isArray(c.listeningQuestions) ? c.listeningQuestions.slice(0, 2) : [];

  host.className = 'card';
  host.innerHTML = `
    <h4 style="margin:0 0 8px">Content preview — ${escapeHtml(title || 'Current')}</h4>
    <div class="grid-two" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <strong>Warm-up (sample)</strong>
        <ul class="bullet-list">${warmup.length ? warmup.map((q) => `<li>${escapeHtml(q)}</li>`).join('') : '<li>-</li>'}</ul>
      </div>
      <div>
        <strong>Grammar (sample)</strong>
        <ul class="bullet-list">${grammar.length ? grammar.map((g) => `<li>${escapeHtml(g.q || '-')} <em>[${escapeHtml(g.a || '-')}]</em></li>`).join('') : '<li>-</li>'}</ul>
      </div>
      <div>
        <strong>Vocabulary (sample)</strong>
        <ul class="bullet-list">${vocab.length ? vocab.map((v) => `<li>${escapeHtml(v.prompt || '-')} <em>[${escapeHtml(v.a || '-')} ]</em></li>`).join('') : '<li>-</li>'}</ul>
      </div>
      <div>
        <strong>Writing prompt</strong>
        <p style="margin:4px 0">${escapeHtml(typeof c.writingPrompt === 'string' ? c.writingPrompt : '-')}</p>
      </div>
      <div>
        <strong>Pronunciation (sample)</strong>
        <ul class="bullet-list">${pron.length ? pron.map((p) => `<li>${escapeHtml(p)}</li>`).join('') : '<li>-</li>'}</ul>
      </div>
      <div>
        <strong>Listening (sample)</strong>
        <p style="margin:4px 0">${escapeHtml(typeof c.listeningScript === 'string' ? c.listeningScript.slice(0, 180) + (c.listeningScript.length > 180 ? '…' : '') : '-')}</p>
        <ul class="bullet-list">${listenQ.length ? listenQ.map((q) => `<li>${escapeHtml(q.q || '-')}</li>`).join('') : '<li>-</li>'}</ul>
      </div>
    </div>
  `;
}

function previewSettingsCurrentContent() {
  renderSettingsPreview(getCurrentContentPayload(), 'Current in-memory content');
}

async function previewSettingsSelectedPack() {
  try {
    const selectedId = String(document.getElementById('content-pack-select')?.value || state.selectedContentPackId || '').trim();
    if (!selectedId) {
      const host = document.getElementById('settings-preview');
      if (host) {
        host.className = 'notice';
        host.textContent = 'No saved pack selected in Session Setup.';
      }
      return;
    }

    const res = await fetch(`${API_CONTENT_PACKS}/${encodeURIComponent(selectedId)}?profileId=${encodeURIComponent(FIXED_PROFILE_ID)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.pack) throw new Error(data.error || `HTTP ${res.status}`);
    state.selectedContentPack = data.pack;
    state.selectedContentPackId = selectedId;
    renderSettingsPreview(data.pack.content || {}, `${data.pack.packName || `Pack #${selectedId}`}`);
  } catch (e) {
    const host = document.getElementById('settings-preview');
    if (host) {
      host.className = 'notice';
      host.textContent = `Could not preview selected pack: ${e.message}`;
    }
  }
}

function usePreviewPackForSession() {
  const selectedId = String(document.getElementById('content-pack-select')?.value || state.selectedContentPackId || '').trim();
  if (!selectedId) {
    const host = document.getElementById('settings-preview');
    if (host) {
      host.className = 'notice';
      host.textContent = 'No pack selected. Choose one in Session Setup and preview it first.';
    }
    return;
  }

  state.selectedContentPackId = selectedId;

  const combo = document.getElementById('content-pack-select');
  if (combo) combo.value = selectedId;

  const notice = document.getElementById('setup-notice');
  if (notice) notice.textContent = `Pack #${selectedId} selected for the next session start.`;

  const host = document.getElementById('settings-preview');
  if (host) {
    host.className = 'notice';
    host.textContent = `Pack #${selectedId} is now active for Start Session.`;
  }
}

function saveSettingsFromScreen() {
  const level = document.getElementById('settings-target-level')?.value || 'C1-lite';
  const mode = document.getElementById('settings-generation-mode')?.value || 'chunked';
  const llmAll = !!document.getElementById('settings-llm-all')?.checked;

  state.settings.targetLevel = level;
  state.settings.generationMode = mode;
  state.settings.llmAllSections = llmAll;
  state.difficultyLevel = level;
  state.cefrLevelEstimate = level;

  const notice = document.getElementById('setup-notice');
  if (notice) {
    notice.textContent = `Settings saved. Level=${level}, mode=${mode}, all-sections=${llmAll ? 'on' : 'off'}.`;
  }
}

async function generateSessionContent() {
  if (state.settings.llmAllSections && state.settings.generationMode === 'chunked') {
    return generateSessionContentChunked(state.settings.targetLevel);
  }

  const ws = document.getElementById('workspace');
  ws.innerHTML = `
    <div class="card">
      <h3>Generating session content…</h3>
      <div class="generating-overlay">
        <div class="loading-dots"><span></span><span></span><span></span></div>
        <p>The AI is preparing fresh exercises for session&nbsp;#${escapeHtml(state.sessionNumber)} at level&nbsp;${escapeHtml(state.cefrLevelEstimate)}.</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch(API_GENERATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: state.difficultyLevel, sessionNumber: state.sessionNumber }),
    });
    const data = await res.json();
    if (!res.ok || !data.content) throw new Error(data.error || `HTTP ${res.status}`);

    const c = data.content;
    warmupQuestions      = c.warmupQuestions.slice(0, 4);
    grammarItems         = c.grammarItems.slice(0, 8);
    vocabItems           = c.vocabItems.slice(0, 12);
    vocabWordBank        = vocabItems.map((v) => v.a);
    vocabCardDictionary  = {};
    vocabItems.forEach((v) => {
      vocabCardDictionary[v.a] = {
        meaningES: v.meaningES || '',
        exampleEN: v.exampleEN || v.prompt.replace('____', v.a),
      };
    });
    pronunciationPhrases   = c.pronunciationPhrases.slice(0, 8);
    listeningScript        = c.listeningScript;
    listeningQuestions     = c.listeningQuestions.slice(0, 5);
    writingPrompt          = c.writingPrompt;

    // sync pronunciation transcript slots to new phrase count
    state.pronunciationTranscripts = Array(pronunciationPhrases.length).fill('');

    try {
      const saved = await saveGeneratedContentPack();
      const notice = document.getElementById('setup-notice');
      if (notice) notice.textContent = `Content generated and saved in SQLite as pack #${saved.id}.`;
    } catch (saveErr) {
      console.warn('could not save generated content pack:', saveErr);
    }

    return true;
  } catch (e) {
    console.warn('generate-session failed, keeping defaults:', e);
    ws.innerHTML = `
      <div class="card">
        <p class="bad">Could not generate new content: ${escapeHtml(e.message)}.</p>
        <p>The session will use built-in exercises.</p>
        <div class="inline-actions">
          <button class="btn-warn" onclick="generateSessionContent().then(ok => { if(ok) buildWarmupStep(); })">Retry</button>
          <button class="btn-secondary" onclick="buildWarmupStep()">Continue with defaults</button>
        </div>
      </div>
    `;
    return false;
  }
}

function buildVocabularyPromptByDifficulty(basePrompt, idx) {
  if (state.difficultyLevel === 'C1-lite') {
    const variants = [
      'Use one high-precision business collocation.',
      'Avoid generic verbs; prefer a nuanced alternative.',
      'Keep register appropriate for executive meetings.',
    ];
    return `${basePrompt} (${variants[idx % variants.length]})`;
  }
  if (state.difficultyLevel === 'B2+') {
    return `${basePrompt} (Try a natural workplace collocation.)`;
  }
  return basePrompt;
}

const studyResources = {
  speaking: [
    { label: 'BBC Learning English - Speaking', url: 'https://www.bbc.co.uk/learningenglish/english/features/speaking-skills' },
    { label: 'British Council - Speaking B2', url: 'https://learnenglish.britishcouncil.org/skills/speaking/b2-speaking' },
    { label: 'TED - Public Speaking Tips', url: 'https://www.ted.com/playlists/226/tips_for_better_public_speaking' },
  ],
  grammar: [
    { label: 'Perfect English Grammar', url: 'https://www.perfect-english-grammar.com/' },
    { label: 'Cambridge Grammar', url: 'https://dictionary.cambridge.org/grammar/british-grammar/' },
    { label: 'British Council - Grammar', url: 'https://learnenglish.britishcouncil.org/grammar' },
  ],
  vocabulary: [
    { label: 'Oxford Learner Dictionaries', url: 'https://www.oxfordlearnersdictionaries.com/' },
    { label: 'Ozdic Collocations', url: 'https://ozdic.com/' },
    { label: 'Vocabulary.com', url: 'https://www.vocabulary.com/' },
  ],
  writing: [
    { label: 'Purdue OWL - Writing', url: 'https://owl.purdue.edu/owl/general_writing/index.html' },
    { label: 'British Council - Writing B2', url: 'https://learnenglish.britishcouncil.org/skills/writing/b2-writing' },
    { label: 'Email Writing Guide', url: 'https://www.grammarly.com/blog/email-writing/' },
  ],
  pronunciation: [
    { label: 'Rachel\'s English', url: 'https://rachelsenglish.com/' },
    { label: 'YouGlish', url: 'https://youglish.com/' },
    { label: 'Cambridge Pronunciation', url: 'https://dictionary.cambridge.org/help/pronunciation.html' },
  ],
  listening: [
    { label: 'ELLLO Listening Library', url: 'https://elllo.org/' },
    { label: 'BBC Learning English - 6 Minute English', url: 'https://www.bbc.co.uk/learningenglish/english/features/6-minute-english' },
    { label: 'VOA Learning English', url: 'https://learningenglish.voanews.com/' },
  ],
};

let speechSupported = !!window.speechSynthesis;
let recognitionSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
let activeRecognition = null;
let activeRecordingTimeout = null;
let activeRecordingTimer = null;
let activeRecordingStart = 0;

function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function showRecordingPopup(caption = 'Speak clearly and pause naturally between ideas.') {
  const popup = document.getElementById('recording-popup');
  const time = document.getElementById('recording-time');
  const limit = document.getElementById('recording-limit');
  const cap = document.getElementById('recording-caption');
  if (!popup || !time || !limit || !cap) return;

  cap.textContent = caption;
  time.textContent = '00:00';
  limit.textContent = `Max ${Math.floor(MAX_RECORDING_MS / 1000)}s`;
  popup.classList.add('visible');

  activeRecordingStart = Date.now();
  clearInterval(activeRecordingTimer);
  activeRecordingTimer = setInterval(() => {
    time.textContent = formatMs(Date.now() - activeRecordingStart);
  }, 150);
}

function hideRecordingPopup() {
  const popup = document.getElementById('recording-popup');
  if (popup) popup.classList.remove('visible');
  clearInterval(activeRecordingTimer);
  activeRecordingTimer = null;
}

function stopActiveRecording() {
  clearTimeout(activeRecordingTimeout);
  activeRecordingTimeout = null;
  if (activeRecognition) {
    try { activeRecognition.stop(); } catch (_) {}
  }
}

function scoreCard(label, value) {
  const pct = Math.max(0, Math.min(100, Number(value || 0) * 10));
  return `<div class="score-card"><div class="score-label">${label}</div><div class="score-val">${Number(value || 0).toFixed(1)}</div><div class="progress"><span style="width:${pct}%"></span></div></div>`;
}

function renderScores() {
  const grid = document.getElementById('score-grid');
  grid.innerHTML = [
    scoreCard('Vocab', state.scores.vocab),
    scoreCard('Grammar', state.scores.grammar),
    scoreCard('Writing', state.scores.writing),
    scoreCard('Pronunciation', state.scores.pronunciation),
    scoreCard('Listening', state.scores.listening),
    scoreCard('Fluency', state.scores.fluency),
  ].join('');
}

function resourceLinksHtml(type) {
  const links = Array.isArray(studyResources[type]) ? studyResources[type] : [];
  if (!links.length) return '';
  const anchors = links
    .map((r) => `<a href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label)}</a>`)
    .join('');
  return `<div class="resource-links"><strong>Study resources</strong>${anchors}</div>`;
}

function createSessionVocabularyCards() {
  const cards = vocabWordBank.map((term) => {
    const key = String(term || '').toLowerCase();
    const info = vocabCardDictionary[key] || { meaningES: '', exampleEN: '' };
    return {
      term,
      meaningES: info.meaningES || '',
      exampleEN: info.exampleEN || '',
    };
  });
  state.vocabularyCards = cards;
  return cards;
}

function renderVocabularyCardDeck(cards, noticeText = '') {
  const container = document.getElementById('vocab-card-deck');
  if (!container) return;

  const safeCards = Array.isArray(cards) ? cards : [];
  if (!safeCards.length) {
    container.innerHTML = `<div class="notice">${escapeHtml(noticeText || 'No cards yet. Generate Learning Log to create this session deck.')}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="deck-wrap">
      <div class="subtitle">Click a card to flip and see meaning + example.</div>
      <div class="deck-grid">
        ${safeCards.map((c, idx) => `
          <div class="flip-card" data-card-idx="${idx}">
            <div class="flip-card-inner">
              <div class="flip-face flip-front">
                <div class="flip-term">${escapeHtml(c.term || '')}</div>
                <div class="flip-hint">Tap to reveal</div>
              </div>
              <div class="flip-face flip-back">
                <div class="flip-meaning"><strong>Meaning (ES):</strong> ${escapeHtml(c.meaningES || '-')}</div>
                <div class="flip-example"><strong>Example:</strong> ${escapeHtml(c.exampleEN || '-')}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.flip-card').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('flipped');
    });
  });
}

async function saveVocabularyCards() {
  const cards = state.vocabularyCards.length ? state.vocabularyCards : createSessionVocabularyCards();
  const payload = {
    profileId: FIXED_PROFILE_ID,
    sessionNumber: String(state.sessionNumber || '').trim(),
    cards,
  };

  const res = await fetch(API_VOCAB_CARDS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vocabularyCards: payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const savedCards = Array.isArray(data?.vocabularyCards?.cards) ? data.vocabularyCards.cards : cards;
  state.vocabularyCards = savedCards.map((c) => ({
    term: c.term || '',
    meaningES: c.meaningES || '',
    exampleEN: c.exampleEN || '',
  }));
  renderVocabularyCardDeck(state.vocabularyCards, `Cards saved for session #${state.sessionNumber}.`);
}

async function loadVocabularyCards(profileId, sessionNumber) {
  const base = `${API_VOCAB_CARDS}?profileId=${encodeURIComponent(profileId)}`;
  const url = sessionNumber
    ? `${base}&sessionNumber=${encodeURIComponent(sessionNumber)}`
    : base;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const cards = Array.isArray(data.cards) ? data.cards : [];
  state.vocabularyCards = cards.map((c) => ({
    term: c.term || '',
    meaningES: c.meaningES || c.meaning_es || '',
    exampleEN: c.exampleEN || c.example_en || '',
  }));

  return state.vocabularyCards;
}

function setVoiceStatus() {
  const el = document.getElementById('voice-status');
  if (speechSupported && recognitionSupported) {
    el.textContent = 'Audio: speech output + microphone input available';
    return;
  }
  if (speechSupported && !recognitionSupported) {
    el.textContent = 'Audio: output available, mic ASR unavailable (use text inputs)';
    return;
  }
  el.textContent = 'Audio: browser audio APIs not fully available';
}

function speak(text) {
  if (!speechSupported || !text) return;
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = 0.95;
  u.pitch = 1.0;
  u.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function detectRepeats(items) {
  const map = new Map();
  for (const it of items) {
    const key = String(it || '').toLowerCase().trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].filter((x) => x[1] >= 3).map((x) => x[0]);
}

function startASR(onText) {
  if (!recognitionSupported) {
    alert('Speech recognition is not supported in this browser. Please type your answer.');
    onText('');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let latest = '';
  let finalTranscript = '';

  activeRecognition = rec;
  showRecordingPopup('Speak clearly in English. The recording will stop automatically.');

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) {
        finalTranscript += (finalTranscript ? ' ' : '') + chunk;
      } else {
        interim += (interim ? ' ' : '') + chunk;
      }
    }
    latest = (finalTranscript || interim || '').trim();
  };

  rec.onerror = () => {
    hideRecordingPopup();
    clearTimeout(activeRecordingTimeout);
    activeRecordingTimeout = null;
    activeRecognition = null;
    onText((finalTranscript || latest || '').trim());
  };

  activeRecordingTimeout = setTimeout(() => {
    try { rec.stop(); } catch (_) {}
    activeRecordingTimeout = null;
  }, MAX_RECORDING_MS);

  rec.onend = () => {
    hideRecordingPopup();
    clearTimeout(activeRecordingTimeout);
    activeRecordingTimeout = null;
    activeRecognition = null;
    onText((finalTranscript || latest || '').trim());
  };

  function startASR(onText) {
    if (!recognitionSupported) {
      alert('Speech recognition is not supported in this browser. Please type your answer.');
      onText('');
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let finalTranscript = '';
    let stopped = false;
    const deadline = Date.now() + MAX_RECORDING_MS;

    activeRecognition = null;
    showRecordingPopup('Speak clearly in English. Recording up to ' + Math.floor(MAX_RECORDING_MS / 1000) + 's — press Stop when done.');

    function done() {
      if (stopped) return;
      stopped = true;
      hideRecordingPopup();
      clearTimeout(activeRecordingTimeout);
      activeRecordingTimeout = null;
      activeRecognition = null;
      onText(finalTranscript.trim());
    }

    function startChunk() {
      if (stopped || Date.now() >= deadline) { done(); return; }

      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      activeRecognition = rec;

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const chunk = event.results[i][0]?.transcript || '';
            finalTranscript += (finalTranscript ? ' ' : '') + chunk;
          }
        }
      };

      rec.onerror = (e) => {
        if ((e.error === 'no-speech' || e.error === 'audio-capture') && !stopped && Date.now() < deadline) {
          setTimeout(startChunk, 100);
        } else {
          done();
        }
      };

      rec.onend = () => {
        if (!stopped && Date.now() < deadline) {
          setTimeout(startChunk, 80);
        } else {
          done();
        }
      };

      try { rec.start(); } catch (_) { done(); }
    }

    // Hard deadline regardless of chunk state
    activeRecordingTimeout = setTimeout(() => {
      if (!stopped) {
        try { activeRecognition?.stop(); } catch (_) {}
        done();
      }
    }, MAX_RECORDING_MS);

    startChunk();
  }

function buildWarmupStep() {
  const wrap = document.getElementById('workspace');
  document.getElementById('stage-title').textContent = 'Step 1: Speaking Warm-up';
  document.getElementById('stage-meta').textContent = `Answer 4 open questions in audio or text. Difficulty: ${state.difficultyLevel}.`;
  document.getElementById('live-step').textContent = 'Step 1/6';

  const blocks = warmupQuestions.map((q, i) => {
    return `<div class="question">
      <strong>${i + 1}. ${q}</strong>
      <textarea id="warmup-${i}" placeholder="Your answer (or ASR transcript)...">${escapeHtml(state.warmupTranscripts[i] || '')}</textarea>
      <div class="inline-actions">
        <button class="btn-warn" onclick="captureWarmup(${i})">🎙️ Speak now</button>
        <button class="btn-secondary" onclick="playPrompt('${escapeAttr(q)}')">🔊 Respond with voice</button>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <h3>Speaking Warm-up</h3>
      <p>Speak naturally for 60-90 seconds in total. Then submit for feedback in Meaning, Accuracy, Naturalness, and Pronunciation.</p>
      ${blocks}
      <div class="inline-actions">
        <button class="btn-primary" onclick="submitWarmup()">Submit warm-up</button>
      </div>
      <div id="warmup-feedback"></div>
    </div>`;
}

function captureWarmup(i) {
  startASR((text) => {
    state.warmupTranscripts[i] = text;
    const box = document.getElementById(`warmup-${i}`);
    if (box) box.value = text;
  });
}

function playPrompt(text) {
  speak(text);
}

function submitWarmup() {
  for (let i = 0; i < warmupQuestions.length; i++) {
    const val = document.getElementById(`warmup-${i}`)?.value || '';
    state.warmupTranscripts[i] = val.trim();
  }

  const joined = state.warmupTranscripts.join(' ').trim();
  const words = countWords(joined);
  const fillerMatches = joined.match(/\b(uh|um|eh|mmm|you know|like|sort of|kind of|basically)\b/gi) || [];
  const fillerCount = fillerMatches.length;
  const uniqueWords = new Set(joined.toLowerCase().split(/\W+/).filter(w => w.length > 2)).size;
  const diversity = words > 5 ? uniqueWords / words : 0;
  const hasSpanishInterference = /\b(i am agree|he go|she go|people is|informations|advices|we are winner)\b/i.test(joined);
  const hasComplexStructures = /\b(would have|had been|since|although|despite|whereas|provided that|even though)\b/i.test(joined);
  const hasConnectors = /\b(however|moreover|although|because|since|as a result|therefore|furthermore|in addition)\b/i.test(joined);

  const fluencyRaw = 3.5 + (words / 80) * 4.5 - fillerCount * 0.3;
  state.scores.fluency = Number(Math.max(2, Math.min(9.5, fluencyRaw)).toFixed(1));
  state.scores.vocab = Number(Math.max(2, Math.min(9, diversity * 14)).toFixed(1));
  state.scores.grammar = Number(Math.max(2, Math.min(9, 6.5 - (hasSpanishInterference ? 1.5 : 0) + (hasComplexStructures ? 0.8 : 0) - fillerCount * 0.1)).toFixed(1));
  state.scores.pronunciation = Number(Math.max(2, Math.min(9, 6.5 - fillerCount * 0.15)).toFixed(1));

  const recurring = [];
  if (fillerCount >= 3) recurring.push(`Filler words detected (${fillerCount}x): ${[...new Set(fillerMatches.map(f => f.toLowerCase()))].join(', ')}`);
  if (hasSpanishInterference) recurring.push('Grammar transfer from Spanish (e.g. "I am agree", "informations")');
  if (/\bthing\b/i.test(joined) && !/\bissue|aspect|point|feature|element|factor\b/i.test(joined)) recurring.push('Lexical imprecision: "thing" overused - prefer issue, aspect, factor, element');
  if (words < 40) recurring.push('Answers too short - expand each response with a concrete example or detail');
  if (!hasConnectors) recurring.push('Limited discourse connectors - try: however, moreover, although, therefore');
  state.recurringErrors = recurring.slice(0, 5);

  const answerRows = warmupQuestions.map((q, i) => {
    const t = state.warmupTranscripts[i] || '';
    const wc = countWords(t);
    const quality = wc >= 20
      ? `<span class="good">✓ ${wc} words</span>`
      : wc >= 8
        ? `<span style="color:#c08020">⚠ ${wc} words - expand further</span>`
        : `<span class="bad">✗ ${wc} words - too short</span>`;
    return `<li><strong>Q${i + 1}:</strong> ${quality} &mdash; <em>${escapeHtml(q)}</em></li>`;
  }).join('');

  const tips = [];
  if (words < 60) tips.push('Aim for at least 15-20 words per answer and include one concrete example.');
  else tips.push('Good word output - focus now on lexical precision and variety.');
  if (fillerCount > 2) tips.push(`Reduce fillers (${fillerCount} detected) - pause silently instead of saying "uh/um".`);
  else tips.push('Filler use is controlled - keep it up.');
  if (!hasComplexStructures) tips.push('Attempt complex structures: "Although..., I...", "If I had..., I would...", "Since..., we..."');
  else tips.push('Good use of complex structures - maintain this in later steps.');

  document.getElementById('warmup-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Warm-up - ${words} words total · ${fillerCount} fillers · level ${escapeHtml(state.cefrLevelEstimate)}</div>
      <ul class="bullet-list">${answerRows}</ul>
      <ul class="bullet-list" style="margin-top:6px">
        ${tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
        ${recurring.length ? `<li><strong>Patterns to watch:</strong> ${recurring.map(escapeHtml).join('; ')}</li>` : ''}
      </ul>
      ${resourceLinksHtml('speaking')}
    </div>
    <div class="inline-actions"><button class="btn-primary" onclick="buildGrammarStep()">Continue to Grammar</button></div>
  `;

  renderScores();
}

function inferGrammarConcept(item) {
  if (item.concept && typeof item.concept === 'string' && item.concept.trim()) return item.concept.trim();
  const a = (item.a || '').toLowerCase();
  const opts = (item.options || []).map(o => (o || '').toLowerCase());
  if (opts.every(o => ['a', 'an', 'the', ''].includes(o))) return 'Articles';
  const prepositions = ['to', 'in', 'at', 'on', 'with', 'for', 'of', 'by', 'from', 'about', 'into'];
  if (prepositions.includes(a) && a.split(' ').length === 1) return 'Prepositions';
  if (/will have/.test(a)) return 'Future Perfect';
  if (/would(?: not)? have/.test(a)) return 'Third Conditional';
  if (/\bhad\b/.test(a) && /\bif\b/i.test(item.q || '')) return 'Second Conditional';
  if (/\bhad\b/.test(a)) return 'Reported Speech / Past Perfect';
  if (/\b(was|were)\b/.test(a) && /ed\b/.test(a)) return 'Passive Voice';
  if (/\b(has|have)\b/.test(a)) return 'Present Perfect';
  return 'Grammar structure';
}

const grammarConceptExplanation = {
  'Future Perfect':             'Future Perfect (will have + past participle) describes an action that will be completed before a specific future moment.',
  'Second Conditional':         'Second Conditional (If + Past Simple, would + infinitive) describes hypothetical present or future situations.',
  'Third Conditional':          'Third Conditional (If + Past Perfect, would have + past participle) describes unreal past situations and their imagined results.',
  'Passive Voice':              'Passive Voice (was/were + past participle) is used when the action matters more than who does it.',
  'Reported Speech / Past Perfect': 'Reported Speech often shifts tenses back one step: present → past simple, past → past perfect.',
  'Past Perfect':               'Past Perfect (had + past participle) describes an action completed before another past action.',
  'Present Perfect':            'Present Perfect (have/has + past participle) links a past action to the present moment.',
  'Prepositions':               'Preposition collocations are fixed: speak TO, good AT, interested IN — these must be memorised.',
  'Articles':                   'Use "the" for specific or unique items, "a/an" for general ones, and no article for uncountable or plural general nouns.',
  'Grammar structure':          'Review the grammar structure tested carefully and check its usage rules.',
};

function buildGrammarStep() {
  state.currentStep = 2;
  document.getElementById('stage-title').textContent = 'Step 2: Grammar Check';
  document.getElementById('stage-meta').textContent = `8 items aligned to ${state.difficultyLevel}: tenses, conditionals, reported speech, passive, articles, prepositions.`;
  document.getElementById('live-step').textContent = 'Step 2/6';

  const items = grammarItems.map((it, idx) => {
    const options = it.options.map((op) => `<option value="${escapeAttr(op)}">${escapeHtml(op)}</option>`).join('');
    return `<div class="question"><strong>${idx + 1}. ${escapeHtml(it.q)}</strong><select id="grammar-${idx}"><option value="">Choose...</option>${options}</select></div>`;
  }).join('');

  document.getElementById('workspace').innerHTML = `
    <div class="card">
      <h3>Grammar check</h3>
      <p>Complete all 8 items.</p>
      ${items}
      <div class="inline-actions"><button class="btn-primary" onclick="submitGrammar()">Submit grammar</button></div>
      <div id="grammar-feedback"></div>
    </div>
  `;
}

function submitGrammar() {
  let ok = 0;
  const results = [];
  grammarItems.forEach((it, i) => {
    const val = document.getElementById(`grammar-${i}`)?.value || '';
    const isCorrect = val === it.a;
    if (isCorrect) ok++;
    results.push({ it, val, isCorrect });
  });

  state.scores.grammar = Number(((ok / grammarItems.length) * 10).toFixed(1));
  if (ok < grammarItems.length * 0.75) {
    state.recurringErrors = [...new Set([...state.recurringErrors, 'Complex verb forms and grammar structures need review'])].slice(0, 5);
  }
  recalcDifficultyFromPerformance();

  const itemRows = results.map(({ it, val, isCorrect }, i) => {
    const concept = inferGrammarConcept(it);
    const explanation = grammarConceptExplanation[concept] || '';
    const sentenceCorrect = escapeHtml(it.q.replace('____', it.a));
    const badge = isCorrect
      ? `<span class="vocab-review-badge ok">✓ Correcto</span>`
      : `<span class="vocab-review-badge err">✗ Incorrecto</span>`;
    const correction = isCorrect ? '' :
      `<div>Tu respuesta: <span class="bad">${escapeHtml(val || '(sin respuesta)')}</span> &mdash; Correcto: <span class="good">${escapeHtml(it.a)}</span></div>`;
    const why = explanation
      ? `<div class="vocab-review-why"><strong>Concepto:</strong> ${escapeHtml(concept)} — ${escapeHtml(explanation)}</div>`
      : `<div class="vocab-review-why"><strong>Concepto:</strong> ${escapeHtml(concept)}</div>`;
    return `
      <li class="vocab-review-item ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="vocab-review-sentence">${i + 1}. ${sentenceCorrect}</div>
        <div>${badge} <span style="font-size:11px;color:var(--muted)">${escapeHtml(concept)}</span>${correction}</div>
        ${why}
      </li>`;
  }).join('');

  document.getElementById('grammar-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Grammar result &mdash; ${ok}/${grammarItems.length} correct</div>
      <ul class="vocab-review-list">${itemRows}</ul>
      ${resourceLinksHtml('grammar')}
    </div>
    <div class="inline-actions"><button class="btn-primary" onclick="buildVocabStep()">Continue to Vocabulary</button></div>
  `;
  renderScores();
}

function buildVocabStep() {
  state.currentStep = 3;
  document.getElementById('stage-title').textContent = 'Step 3: Vocabulary in Context';
  document.getElementById('stage-meta').textContent = `12 collocations and phrases. Adaptive level: ${state.difficultyLevel}.`;
  document.getElementById('live-step').textContent = 'Step 3/6';

  const items = vocabItems.map((it, i) => {
    return `<div class="question"><strong>${i + 1}. ${escapeHtml(buildVocabularyPromptByDifficulty(it.prompt, i))}</strong><input id="vocab-${i}" type="text" placeholder="Type one word or phrase"></div>`;
  }).join('');

  const bank = vocabWordBank.map((w) => `<span class="pill">${escapeHtml(w)}</span>`).join('');

  document.getElementById('workspace').innerHTML = `
    <div class="card">
      <h3>Vocabulary drill</h3>
      <p>Fill each gap with the best collocation or phrase.</p>
      <div class="question">
        <strong>Possible words/phrases (Word Bank)</strong>
        <div class="inline-actions">${bank}</div>
      </div>
      ${items}
      <div class="inline-actions"><button class="btn-primary" onclick="submitVocab()">Submit vocabulary</button></div>
      <div id="vocab-feedback"></div>
    </div>
  `;
}

function submitVocab() {
  let ok = 0;
  const results = [];
  const learned = [];

  vocabItems.forEach((it, i) => {
    const val = (document.getElementById(`vocab-${i}`)?.value || '').trim();
    const isCorrect = val.toLowerCase() === it.a.toLowerCase();
    if (isCorrect) ok++;
    const dict = vocabCardDictionary[it.a] || {};
    results.push({ it, val, isCorrect, dict });
    learned.push({
      term: it.a,
      meaningES: dict.meaningES || 'Expresion de uso frecuente en contexto profesional',
      exampleEN: it.prompt.replace('____', it.a),
    });
  });

  state.newVocabulary = learned.slice(0, 10);
  state.scores.vocab = Number(((ok / vocabItems.length) * 10).toFixed(1));
  recalcDifficultyFromPerformance();

  const itemRows = results.map(({ it, val, isCorrect, dict }, i) => {
    const sentenceCorrect = escapeHtml(it.prompt.replace('____', it.a));
    const userAnswer = val ? escapeHtml(val) : '<em>sin respuesta</em>';
    const badge = isCorrect
      ? `<span class="vocab-review-badge ok">✓ Correcto</span>`
      : `<span class="vocab-review-badge err">✗ Incorrecto</span>`;
    const correction = isCorrect
      ? ''
      : `<div>Tu respuesta: <span class="bad">${userAnswer}</span> &mdash; Correcto: <span class="good">${escapeHtml(it.a)}</span></div>`;
    const why = dict.meaningES
      ? `<div class="vocab-review-why"><strong>¿Por qué?</strong> "${escapeHtml(it.a)}" significa <em>${escapeHtml(dict.meaningES)}</em>. Ejemplo: <em>${escapeHtml(dict.exampleEN || '')}</em>.</div>`
      : '';
    return `
      <li class="vocab-review-item ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="vocab-review-sentence">${i + 1}. ${sentenceCorrect}</div>
        <div>${badge}${correction}</div>
        ${why}
      </li>`;
  }).join('');

  document.getElementById('vocab-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Vocabulary result &mdash; ${ok}/${vocabItems.length} correct</div>
      <ul class="vocab-review-list">${itemRows}</ul>
      ${resourceLinksHtml('vocabulary')}
    </div>
    <div class="inline-actions"><button class="btn-primary" onclick="buildWritingStep()">Continue to Writing</button></div>
  `;

  createSessionVocabularyCards();
  renderVocabularyCardDeck(state.vocabularyCards, 'Vocabulary cards generated for this session.');

  renderScores();
}

function buildWritingStep() {
  state.currentStep = 4;
  document.getElementById('stage-title').textContent = 'Step 4: Writing Mini-Task';
  document.getElementById('stage-meta').textContent = `Write 120-150 words with ${state.difficultyLevel} target register, then receive correction and style upgrades.`;
  document.getElementById('live-step').textContent = 'Step 4/6';

  document.getElementById('workspace').innerHTML = `
    <div class="card">
      <h3>Writing task (120-150 words)</h3>
      <p>Prompt: ${escapeHtml(writingPrompt)}</p>
      <textarea id="writing-text" placeholder="Write your email here..."></textarea>
      <div class="inline-actions">
        <button class="btn-primary" onclick="submitWriting()">Evaluate writing</button>
        <button class="btn-secondary" onclick="playPrompt('Please write one hundred and twenty to one hundred and fifty words now.')">🔊 Respond with voice</button>
      </div>
      <div id="writing-feedback"></div>
    </div>
  `;
}

function rewriteWriting(text) {
  let fixed = String(text || '').trim();
  fixed = fixed.replace(/\bi\b/g, 'I');
  fixed = fixed.replace(/\bpls\b/gi, 'please');
  fixed = fixed.replace(/\bthx\b/gi, 'thank you');
  fixed = fixed.replace(/\bvery very\b/gi, 'highly');
  fixed = fixed.replace(/\bi want to ask you if\b/gi, 'I would like to ask whether');
  fixed = fixed.replace(/\bcan you\b/gi, 'Could you');
  fixed = fixed.replace(/\bgonna\b/gi, 'going to');
  fixed = fixed.replace(/\bwanna\b/gi, 'would like to');
  fixed = fixed.replace(/\bgot to\b/gi, 'need to');
  fixed = fixed.replace(/\bvery important\b/gi, 'crucial');
  fixed = fixed.replace(/\ba lot of\b/gi, 'a significant number of');
  return fixed;
}

function submitWriting() {
  const text = (document.getElementById('writing-text')?.value || '').trim();
  state.writingText = text;
  const words = countWords(text);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgSentLen = words / Math.max(1, sentences.length);
  const corrected = rewriteWriting(text);
  state.writingCorrection = corrected;

  const hasConnectors   = /\b(however|moreover|therefore|in addition|furthermore|consequently|as a result|on the other hand|additionally|nevertheless|in contrast|despite this)\b/i.test(text);
  const hasFormalReg    = /\b(would like|could you|I appreciate|please|sincerely|regarding|I am writing|kindly|I would be|we would|I wish to|I am pleased|I am contacting)\b/i.test(text);
  const hasInformal     = /\b(pls|thx|gonna|wanna|gotta|coz|cause)\b/i.test(text) || /[!]{2,}/.test(text);
  const hasVagueLang    = /\b(very|really|a lot|thing|stuff|nice|good|bad)\b/gi.test(text);
  const hasSentVariety  = avgSentLen >= 8 && avgSentLen <= 22;

  let score = 5.5;
  if (words >= 120 && words <= 150) score += 1.5;
  else if (words >= 90 && words < 120) score += 0.7;
  else if (words > 150 && words <= 180) score += 0.5;
  else if (words < 60) score -= 2.0;
  if (hasConnectors)   score += 0.7;
  if (hasFormalReg)    score += 0.5;
  if (hasSentVariety)  score += 0.3;
  if (hasInformal)     score -= 1.0;

  state.scores.writing = Number(Math.max(2, Math.min(9.8, score)).toFixed(1));
  recalcDifficultyFromPerformance();

  // Dynamic style tips based on actual analysis
  const styleUpgrades = [];
  if (!hasConnectors) styleUpgrades.push('Add discourse markers: however, moreover, therefore, in addition, as a result.');
  if (words < 120) styleUpgrades.push(`Expand text — you wrote ${words} words, target is 120–150. Add an example or elaboration.`);
  if (hasVagueLang) styleUpgrades.push('Replace vague words (very, nice, good, thing) with precise alternatives: significant, compelling, issue, factor.');
  if (!hasFormalReg) styleUpgrades.push('Use formal professional phrases: I would like to, could you please, I appreciate your…, I am writing to…');
  if (sentences.length < 4) styleUpgrades.push('Vary your structure — aim for 4–5 sentences: opening, context, request/point, closing.');
  const finalTips = styleUpgrades.slice(0, 3);
  if (finalTips.length < 3) finalTips.push('Read aloud to catch unnatural phrasing — rewrite anything that sounds like a direct translation.');

  const wordCountBadge = words >= 120 && words <= 150
    ? `<span class="good">${words} words ✓</span>`
    : `<span class="bad">${words} words (target: 120–150)</span>`;

  document.getElementById('writing-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Writing feedback — ${wordCountBadge}</div>
      <ul class="bullet-list">
        <li><strong>Discourse markers:</strong> ${hasConnectors ? '<span class="good">Detected ✓</span>' : '<span class="bad">None — add however, moreover, therefore, as a result.</span>'}</li>
        <li><strong>Register:</strong> ${hasFormalReg ? '<span class="good">Professional tone detected ✓</span>' : '<span class="bad">Informal — use: would like, I appreciate, could you please.</span>'}</li>
        <li><strong>Vague language:</strong> ${hasVagueLang ? '<span class="bad">Detected — replace very/nice/good/thing with precise vocabulary.</span>' : '<span class="good">Good lexical precision ✓</span>'}</li>
        <li><strong>Sentence variety:</strong> ${hasSentVariety ? `<span class="good">Good avg. length (${Math.round(avgSentLen)} words/sentence) ✓</span>` : `<span style="color:#c08020">Avg. ${Math.round(avgSentLen)} words/sentence — vary length.</span>`}</li>
        <li><strong>Corrected version:</strong><br><em>${escapeHtml(corrected)}</em></li>
        <li><strong>${finalTips.length} style improvements:</strong><br>${finalTips.map((t, i) => `${i + 1}. ${escapeHtml(t)}`).join('<br>')}</li>
        <li><strong>Professional sentence bank:</strong><br>${[
          'I would appreciate your prompt response on this matter.',
          'Could we schedule a brief call to discuss this further?',
          'Thank you for your understanding and continued support.',
          'Please do not hesitate to reach out if you need any clarification.',
          'I remain committed to delivering high-quality results within the agreed scope.'
        ].map(escapeHtml).join('<br>')}</li>
      </ul>
      ${resourceLinksHtml('writing')}
    </div>
    <div class="inline-actions"><button class="btn-primary" onclick="buildPronunciationStep()">Continue to Pronunciation</button></div>
  `;

  renderScores();
}
function buildPronunciationStep() {
  state.currentStep = 5;
  document.getElementById('stage-title').textContent = 'Step 5: Pronunciation Guided Drill';
  document.getElementById('stage-meta').textContent = `Focus: TH, V vs B, /ɪ/ vs /iː/, stress, linking, -ed endings. Level: ${state.difficultyLevel}.`;
  document.getElementById('live-step').textContent = 'Step 5/6';

  const blocks = pronunciationPhrases.map((p, i) => {
    return `<div class="question">
      <strong>${i + 1}. ${escapeHtml(p)}</strong>
      <textarea id="pron-${i}" placeholder="Type transcript of what you said..."></textarea>
      <div class="inline-actions">
        <button class="btn-secondary" onclick="playPrompt('${escapeAttr(p)}')">🔊 Respond with voice</button>
        <button class="btn-warn" onclick="capturePron(${i})">🎙️ Speak now</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('workspace').innerHTML = `
    <div class="card">
      <h3>Pronunciation practice: 8 phrases</h3>
      <p>Shadowing mode: listen, repeat, and capture your transcript. Two rounds are recommended.</p>
      ${blocks}
      <div class="inline-actions"><button class="btn-primary" onclick="submitPronunciation()">Evaluate pronunciation</button></div>
      <div id="pron-feedback"></div>
    </div>
  `;
}

function capturePron(i) {
  startASR((text) => {
    state.pronunciationTranscripts[i] = text;
    const box = document.getElementById(`pron-${i}`);
    if (box) box.value = text;
  });
}

function pronunciationAdvice() {
  return [
    {
      feature: 'TH sounds /θ/ and /ð/',
      tip: 'Place tongue gently between teeth; release air softly.',
      practiceSentence: 'They thought the theory was thorough.'
    },
    {
      feature: 'V vs B distinction',
      tip: 'For V, touch lower lip with upper teeth and vibrate voice.',
      practiceSentence: 'Very busy visitors booked a boat.'
    },
    {
      feature: '/ɪ/ vs /iː/',
      tip: 'Keep /ɪ/ short and relaxed, /iː/ longer and tenser.',
      practiceSentence: 'We live in a big city near the sea.'
    }
  ];
}

function submitPronunciation() {
  for (let i = 0; i < pronunciationPhrases.length; i++) {
    state.pronunciationTranscripts[i] = (document.getElementById(`pron-${i}`)?.value || '').trim();
  }

  // Per-phrase scoring
  const phraseResults = pronunciationPhrases.map((p, i) => {
    const targetWords = p.toLowerCase().split(/\W+/).filter(Boolean);
    const heard = (state.pronunciationTranscripts[i] || '').toLowerCase();
    const matchedWords = targetWords.filter(w => heard.includes(w));
    const ratio = matchedWords.length / Math.max(1, targetWords.length);
    const hasTranscript = (state.pronunciationTranscripts[i] || '').trim().length > 0;
    return { phrase: p, ratio, matchedCount: matchedWords.length, total: targetWords.length, transcript: state.pronunciationTranscripts[i] || '', hasTranscript };
  });

  const attempted = phraseResults.filter(r => r.hasTranscript).length;
  const avgRatio = phraseResults.reduce((s, r) => s + r.ratio, 0) / Math.max(1, phraseResults.length);
  const attemptBonus = (attempted / Math.max(1, pronunciationPhrases.length)) * 1.5;
  state.scores.pronunciation = Number(Math.max(2, Math.min(9.5, avgRatio * 8 + attemptBonus)).toFixed(1));
  state.pronunciationTargets = pronunciationAdvice().slice(0, 3);
  recalcDifficultyFromPerformance();

  // Identify weakest phrases for targeted practice
  const weakest = [...phraseResults].sort((a, b) => a.ratio - b.ratio).filter(r => r.ratio < 0.7).slice(0, 3);

  // Detect phoneme patterns in missed phrases
  const missedText = weakest.map(r => r.phrase).join(' ').toLowerCase();
  const phonemeTips = [];
  if (/\bth\w+|\bthe\b|\bthis\b|\bthat\b|\bthey\b|\bthought\b|\bthrough\b/.test(missedText)) {
    phonemeTips.push('TH sounds (/θ/ and /ð/): place tongue gently between your teeth and release air — do not substitute with T or D.');
  }
  if (/\bv\w+|\bvery\b|\bvisit\b|\bvoid\b|\bvalue\b|\breverse\b/.test(missedText)) {
    phonemeTips.push('V vs B: for /v/ touch lower lip to upper teeth and vibrate — do NOT close both lips (that makes /b/).');
  }
  if (/\b\w*ee\w*|\bleave\b|\bthree\b|\bsee\b|\bmeet\b|\blive\b|\bgive\b|\bship\b/.test(missedText)) {
    phonemeTips.push('/ɪ/ vs /iː/: "ship" (/ɪ/) is short and relaxed; "sheep" (/iː/) is longer and tenser — feel the jaw drop slightly for /iː/.');
  }
  if (phonemeTips.length === 0) {
    phonemeTips.push('Focus on stress timing: content words (nouns, verbs, adjectives) carry main stress; reduce function words (the, a, to, of).');
  }
  phonemeTips.push('Shadowing technique: listen once, pause, repeat at the same pace. Record yourself and compare.');

  // Build per-phrase rows
  const phraseRows = phraseResults.map((r, i) => {
    const pct = Math.round(r.ratio * 100);
    const cls = pct >= 80 ? 'correct' : pct < 50 ? 'incorrect' : '';
    const badgeText = pct >= 80 ? `✓ ${pct}%` : pct >= 50 ? `~ ${pct}%` : `✗ ${pct}%`;
    const badgeStyle = pct >= 80
      ? `class="vocab-review-badge ok"`
      : pct >= 50
        ? `class="vocab-review-badge" style="background:#fff3cd;color:#856404"`
        : `class="vocab-review-badge err"`;
    const transcriptNote = r.hasTranscript
      ? `<div class="vocab-review-why">You said: <em>${escapeHtml(r.transcript.slice(0, 80))}${r.transcript.length > 80 ? '…' : ''}</em> &mdash; ${r.matchedCount}/${r.total} words matched</div>`
      : `<div class="vocab-review-why" style="color:var(--danger)">Not attempted — record this phrase next round</div>`;
    return `
      <li class="vocab-review-item ${cls}">
        <div class="vocab-review-sentence">${i + 1}. ${escapeHtml(r.phrase)}</div>
        <div><span ${badgeStyle}>${badgeText}</span></div>
        ${transcriptNote}
      </li>`;
  }).join('');

  const practiceHtml = weakest.length
    ? weakest.map(r => `<li>Practise again: <em>${escapeHtml(r.phrase)}</em></li>`).join('')
    : '<li>All phrases performed well — try increasing speed next session.</li>';

  document.getElementById('pron-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Pronunciation — ${attempted}/${pronunciationPhrases.length} attempted · avg ${Math.round(avgRatio * 100)}% word match</div>
      <ul class="vocab-review-list">${phraseRows}</ul>
      ${weakest.length ? `<div style="margin-top:8px"><strong>Priority phrases for next round:</strong><ul class="bullet-list">${practiceHtml}</ul></div>` : ''}
      <div style="margin-top:8px"><strong>Phoneme tips:</strong>
        <ul class="bullet-list">${phonemeTips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      </div>
      ${resourceLinksHtml('pronunciation')}
    </div>
    <div class="inline-actions"><button class="btn-primary" onclick="buildListeningStep()">Continue to Listening</button></div>
  `;

  renderScores();
}
function buildListeningStep() {
  state.currentStep = 6;
  document.getElementById('stage-title').textContent = 'Step 6: Listening Mini-Podcast';
  document.getElementById('stage-meta').textContent = `Answer 5 questions before seeing transcript. Adaptive level: ${state.difficultyLevel}.`;
  document.getElementById('live-step').textContent = 'Step 6/6';

  const script = currentListeningScript();

  const questions = listeningQuestions.map((q, qi) => {
    const options = q.options.map((op, oi) => `<label><input type="radio" name="listen-${qi}" value="${oi}"> ${escapeHtml(op)}</label>`).join('<br>');
    return `<div class="question"><strong>${qi + 1}. ${escapeHtml(q.q)}</strong><div style="margin-top:6px">${options}</div></div>`;
  }).join('');

  document.getElementById('workspace').innerHTML = `
    <div class="card">
      <h3>Listening task</h3>
      <p>First listen and answer. Do not read transcript yet.</p>
      <div class="inline-actions">
        <button class="btn-secondary" onclick="playPrompt('${escapeAttr(script)}')">🔊 Respond with voice</button>
      </div>
      ${questions}
      <div class="inline-actions"><button class="btn-primary" onclick="submitListening()">Submit listening answers</button></div>
      <div id="listen-feedback"></div>
    </div>
  `;
}

function submitListening() {
  let ok = 0;
  const answers = [];
  listeningQuestions.forEach((q, i) => {
    const selected = document.querySelector(`input[name=\"listen-${i}\"]:checked`);
    const idx = selected ? Number(selected.value) : -1;
    answers.push(idx);
    if (idx === q.a) ok++;
  });
  state.listeningAnswers = answers;
  state.scores.listening = Number(((ok / listeningQuestions.length) * 10).toFixed(1));
  recalcDifficultyFromPerformance();

  const script = currentListeningScript();

  const pct = (ok / listeningQuestions.length) * 100;
  let tuning = 'Keep current level.';
  if (pct > 80) tuning = 'Increase speed and reduce redundancy next session.';
  if (pct < 60) tuning = 'Slow down audio and add stronger discourse signposting.';

  document.getElementById('listen-feedback').innerHTML = `
    <div class="feedback-block">
      <div class="feedback-title">Listening feedback</div>
      <ul class="bullet-list">
        <li>Score: <strong>${ok}/${listeningQuestions.length}</strong></li>
        <li>Difficulty adaptation: ${escapeHtml(tuning)}</li>
        <li><strong>Transcript:</strong><br>${escapeHtml(script)}</li>
        <li><strong>New vocabulary:</strong> clarify outcomes, summarize decisions, check assumptions.</li>
      </ul>
      ${resourceLinksHtml('listening')}
    </div>
  `;

  renderScores();
}

function calcOverallLevel() {
  const avg = computeAverageScore(state.scores);
  if (avg >= 8.5) return 'C1';
  if (avg >= 7.2) return 'B2+';
  if (avg >= 6) return 'B2';
  return 'B1+';
}

function buildHomework() {
  const weak = Object.entries(state.scores).sort((a, b) => a[1] - b[1]).slice(0, 2).map((x) => x[0]);
  const map = {
    vocab: 'Write 12 sentences using today\'s collocations.',
    grammar: 'Do 10 conditional and reported speech transformations.',
    writing: 'Rewrite one email in formal and casual register.',
    pronunciation: 'Shadow 8 target phrases in two rounds.',
    listening: 'Listen to a 2-minute podcast and summarize key points.',
    fluency: 'Record a 90-second answer with fewer fillers.',
  };
  return weak.map((k) => map[k]).slice(0, 3);
}

function targetedFixFromRepeats() {
  const repeated = detectRepeats(state.recurringErrors);
  if (!repeated.length) return [];
  return [
    'Targeted Fix Drill: I would like to clarify the timeline.',
    'Targeted Fix Drill: They thought the solution was feasible.',
    'Targeted Fix Drill: We have been working on this since Monday.',
    'Targeted Fix Drill: If I had prepared more, I would have performed better.',
    'Targeted Fix Drill: Could you elaborate on the main objective?'
  ];
}

function generateLearningLog() {
  const today = new Date().toISOString().slice(0, 10);
  state.nextHomework = buildHomework();
  const repeatedDrill = targetedFixFromRepeats();
  if (repeatedDrill.length) {
    state.nextHomework = [...state.nextHomework, 'Run Targeted Fix Drill (5 sentences, immediate feedback).'].slice(0, 3);
  }

  state.cefrLevelEstimate = calcOverallLevel();
  state.progressIndex = Math.min(10, state.progressIndex + 1);
  state.sessionHistoryCount = Math.max(state.sessionHistoryCount, Number(state.sessionNumber || 0) || 0);

  const log = [
    `Learning Log - ${today}`,
    `Profile ID: ${state.profileId || ''}`,
    `Session #: ${state.sessionNumber || ''}`,
    '',
    'A) Topics worked:',
    '- Speaking warm-up, grammar structures, collocations, writing email register, pronunciation drill, listening comprehension.',
    '',
    'B) Recurring errors (max 5):',
    ...(state.recurringErrors.length ? state.recurringErrors.slice(0, 5).map((e) => `- ${e}`) : ['-']),
    '',
    'C) New vocabulary/expressions (max 10):',
    ...(state.newVocabulary.length
      ? state.newVocabulary.slice(0, 10).map((v) => `- ${v.term}: ${v.exampleEN}`)
      : ['-']),
    '',
    'D) Estimated scores (0-10):',
    `- vocab: ${state.scores.vocab}`,
    `- grammar: ${state.scores.grammar}`,
    `- writing: ${state.scores.writing}`,
    `- pronunciation: ${state.scores.pronunciation}`,
    `- listening: ${state.scores.listening}`,
    `- fluency: ${state.scores.fluency}`,
    '',
    'E) Goals for next session (max 2):',
    ...(state.nextHomework.slice(0, 2).map((h) => `- ${h}`)),
    '',
    'F) Pronunciation Targets (max 3):',
    ...(state.pronunciationTargets.length
      ? state.pronunciationTargets.slice(0, 3).map((p) => `- ${p.feature}: ${p.practiceSentence}`)
      : ['-'])
  ].join('\n');

  state.learningLog = log;

  state.sessionState = {
    profileId: FIXED_PROFILE_ID,
    sessionNumber: state.sessionNumber || '',
    cefrLevelEstimate: state.cefrLevelEstimate || '',
    difficultyLevel: state.difficultyLevel,
    progressIndex: state.progressIndex,
    sessionHistoryCount: state.sessionHistoryCount,
    scores: {
      vocab: state.scores.vocab || 0,
      grammar: state.scores.grammar || 0,
      writing: state.scores.writing || 0,
      pronunciation: state.scores.pronunciation || 0,
      listening: state.scores.listening || 0,
      fluency: state.scores.fluency || 0,
    },
    recurringErrors: state.recurringErrors.slice(0, 5),
    newVocabulary: state.newVocabulary.slice(0, 10),
    pronunciationTargets: state.pronunciationTargets.slice(0, 3),
    nextHomework: state.nextHomework.slice(0, 3),
    vocabularyCards: (state.vocabularyCards.length ? state.vocabularyCards : createSessionVocabularyCards()).slice(0, 20),
  };

  document.getElementById('session-output').textContent = `${log}\n\nSESSION_STATE:\n${JSON.stringify(state.sessionState, null, 2)}`;
}

async function saveSessionState() {
  if (!state.sessionState) {
    alert('Generate Learning Log and SESSION_STATE first.');
    return;
  }
  if (!state.sessionState.profileId || !state.sessionState.sessionNumber) {
    alert('Profile ID and Session # are required.');
    return;
  }

  const res = await fetch(API_STATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionState: state.sessionState }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    alert(`Could not save SESSION_STATE: ${data.error || res.status}`);
    return;
  }

  try {
    await saveVocabularyCards();
  } catch (e) {
    alert(`SESSION_STATE saved, but vocabulary cards could not be stored: ${e.message}`);
    return;
  }

  const savedSession = Number(state.sessionNumber || 0) || 0;
  state.sessionHistoryCount = Math.max(state.sessionHistoryCount, savedSession);
  const nextSession = state.sessionHistoryCount + 1;
  state.sessionNumber = String(nextSession);

  const sessionInput = document.getElementById('session-number');
  if (sessionInput) sessionInput.value = String(nextSession);

  resetSessionData();
  recalcDifficultyFromPerformance();
  renderScores();

  const notice = document.getElementById('setup-notice');
  if (notice) {
    notice.textContent = `Saved. Select a saved SQLite content pack to start session #${nextSession}.`;
  }

  const stageTitle = document.getElementById('stage-title');
  const stageMeta = document.getElementById('stage-meta');
  const liveStep = document.getElementById('live-step');
  if (stageTitle) stageTitle.textContent = 'Ready to Start';
  if (stageMeta) stageMeta.textContent = `Session #${nextSession} ready. Choose a saved content pack and press Start Session.`;
  if (liveStep) liveStep.textContent = 'Step 0/6';

  alert(`SESSION_STATE and vocabulary cards saved. Next session: #${nextSession}. Select a saved content pack to continue.`);
}

async function loadLatestState() {
  const profileId = FIXED_PROFILE_ID;

  const res = await fetch(`${API_STATE}?profileId=${encodeURIComponent(profileId)}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data?.sessionState) {
    document.getElementById('setup-notice').textContent = 'No stored memory found for this profile. Paste the last Learning Log to continue.';
    return;
  }

  const s = data.sessionState;
  state.profileId = FIXED_PROFILE_ID;
  state.sessionNumber = s.sessionNumber || '';
  state.cefrLevelEstimate = s.cefrLevelEstimate || 'C1';
  state.difficultyLevel = String(s.difficultyLevel || 'C1-lite');
  state.progressIndex = Number(s.progressIndex || 0);
  state.sessionHistoryCount = Number(s.sessionHistoryCount || s.sessionNumber || 0);
  state.scores = {
    vocab: Number(s?.scores?.vocab || 0),
    grammar: Number(s?.scores?.grammar || 0),
    writing: Number(s?.scores?.writing || 0),
    pronunciation: Number(s?.scores?.pronunciation || 0),
    listening: Number(s?.scores?.listening || 0),
    fluency: Number(s?.scores?.fluency || 0),
  };
  state.recurringErrors = Array.isArray(s.recurringErrors) ? s.recurringErrors : [];
  state.newVocabulary = Array.isArray(s.newVocabulary) ? s.newVocabulary : [];
  state.pronunciationTargets = Array.isArray(s.pronunciationTargets) ? s.pronunciationTargets : [];
  state.nextHomework = Array.isArray(s.nextHomework) ? s.nextHomework : [];

  document.getElementById('session-number').value = String((Number(state.sessionHistoryCount) || 0) + 1);
  document.getElementById('setup-notice').textContent = 'Latest SESSION_STATE loaded. Start a new session and continue from prior weaknesses.';

  try {
    const cards = await loadVocabularyCards(FIXED_PROFILE_ID, s.sessionNumber || '');
    renderVocabularyCardDeck(cards, cards.length ? '' : 'No saved cards found for that session.');
  } catch (_) {
    renderVocabularyCardDeck([], 'No saved cards found yet. Complete a session and save to store cards.');
  }

  renderScores();
}

async function startSession(fromPreview = false) {
  state.profileId = FIXED_PROFILE_ID;
  state.sessionNumber = (document.getElementById('session-number').value || '').trim();
  state.mainGoal = (document.getElementById('main-goal').value || '').trim();
  state.selectedContentPackId = String(document.getElementById('content-pack-select')?.value || state.selectedContentPackId || '').trim();

  if (!state.sessionNumber && fromPreview) {
    state.sessionNumber = '1';
    const sessionInput = document.getElementById('session-number');
    if (sessionInput) sessionInput.value = '1';
  }

  if (!state.mainGoal && fromPreview) {
    state.mainGoal = 'work';
    const goalSelect = document.getElementById('main-goal');
    if (goalSelect) goalSelect.value = 'work';
  }

  if (!state.sessionNumber || !state.mainGoal) {
    alert('Please provide Session # and main goal.');
    return;
  }

  // If selector is temporarily empty, fallback to latest loaded pack.
  if (!state.selectedContentPackId && Array.isArray(state.contentPacks) && state.contentPacks.length) {
    state.selectedContentPackId = String(state.contentPacks[0].id);
    const sel = document.getElementById('content-pack-select');
    if (sel) sel.value = state.selectedContentPackId;
  }

  if (!state.selectedContentPackId) {
    alert('Please select a saved content pack from SQLite.');
    return;
  }

  resetSessionData();
  recalcDifficultyFromPerformance();

  if (state.settings.llmAllSections) {
    state.difficultyLevel = state.settings.targetLevel;
    state.cefrLevelEstimate = state.settings.targetLevel;
  }

  document.getElementById('setup-notice').textContent = `Loading saved content pack #${state.selectedContentPackId} for session #${state.sessionNumber}…`;
  const ws = document.getElementById('workspace');
  if (ws) {
    ws.innerHTML = `
      <div class="card">
        <h3>Starting session...</h3>
        <p>Applying saved content pack #${escapeHtml(state.selectedContentPackId)}.</p>
      </div>
    `;
  }

  try {
    const pack = await loadSelectedContentPack();
    if (pack.level) {
      state.difficultyLevel = pack.level;
      state.cefrLevelEstimate = pack.level;
    }
  } catch (e) {
    if (state.selectedContentPack && String(state.selectedContentPack.id) === state.selectedContentPackId) {
      applyContentPack(state.selectedContentPack.content || {});
    } else {
      alert(`Could not load saved content pack: ${e.message}`);
      return;
    }
  }

  try {
    speak('Session started. Step one, speaking warm-up. Speak now.');
    buildWarmupStep();
    renderScores();
    document.getElementById('setup-notice').textContent = `Session #${state.sessionNumber} ready from saved pack #${state.selectedContentPackId} — user ${FIXED_PROFILE_ID}, level ${state.cefrLevelEstimate}, focus: ${state.mainGoal}.`;
  } catch (e) {
    alert(`Session could not render Step 1: ${e.message}`);
    const wsFail = document.getElementById('workspace');
    if (wsFail) {
      wsFail.innerHTML = `
        <div class="card">
          <h3 class="bad">Could not render session</h3>
          <p>${escapeHtml(e.message)}</p>
          <div class="inline-actions"><button class="btn-primary" onclick="previewSelectedContentPack(state.selectedContentPackId)">Back to pack preview</button></div>
        </div>
      `;
    }
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function init() {
  const profileInput = document.getElementById('profile-id');
  profileInput.value = FIXED_PROFILE_ID;
  profileInput.readOnly = true;
  profileInput.disabled = true;
  profileInput.title = 'Fixed profile user';

  const nextSession = (Number(state.sessionHistoryCount) || 0) + 1;
  document.getElementById('session-number').value = String(nextSession);

  setVoiceStatus();
  renderScores();
  loadContentPackOptions().catch(() => {});

  document.getElementById('start-session').addEventListener('click', startSession);
  document.getElementById('load-latest').addEventListener('click', loadLatestState);
  document.getElementById('open-settings').addEventListener('click', openSettingsScreen);
  document.getElementById('refresh-packs').addEventListener('click', () => {
    loadContentPackOptions().catch(() => {});
  });
  document.getElementById('content-pack-select').addEventListener('change', (e) => {
    state.selectedContentPackId = String(e.target.value || '').trim();
    previewSelectedContentPack(state.selectedContentPackId).catch(() => {});
  });
  document.getElementById('generate-log').addEventListener('click', generateLearningLog);
  document.getElementById('save-state').addEventListener('click', saveSessionState);

  document.getElementById('mic-test').addEventListener('click', () => {
    startASR((text) => {
      document.getElementById('setup-notice').textContent = `Mic test transcript: ${text || '(no speech detected)'}`;
    });
  });

  document.getElementById('speak-instruction').addEventListener('click', () => {
    speak('Respond with voice. Speak now.');
  });

  document.getElementById('recording-stop-btn').addEventListener('click', () => {
    stopActiveRecording();
  });

  renderVocabularyCardDeck([], 'No cards yet. They will be generated in the Vocabulary step and saved per session.');
}

init();
