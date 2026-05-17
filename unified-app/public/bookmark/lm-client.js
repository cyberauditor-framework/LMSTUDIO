/**
 * lm-client.js (Unified Hub edition)
 * All requests go through /lm/* on the unified server (port 3000),
 * which logs every call and forwards to LM Studio.
 */
const LMClient = (() => {
  'use strict';

  // Base URL = same origin + /lm prefix so all requests go through the proxy
  const PROXY_BASE = window.location.origin + '/lm';

  let config = {
    baseUrl:     PROXY_BASE,
    model:       'nvidia/nemotron-3-nano-4b',
    token:       'sk-lm-7Qe2aLmR:K7pWv4Hj3AJRl85Kk3Y0',
    apiStyle:    'auto',
    contextLen:  8000,
    concurrency: 1,
  };

  let _detectedStyle = null;

  function configure(opts) {
    if (opts.baseUrl !== undefined || opts.model !== undefined) _detectedStyle = null;
    config = { ...config, ...opts };
  }

  function getConfig() { return { ...config }; }

  function authHeaders() {
    return {
      ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
      'X-App': 'bookmark',
    };
  }

  async function checkConnection() {
    try {
      const resp = await fetch(`${config.baseUrl}/v1/models`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        _detectedStyle = 'openai';
        return { ok: true, style: 'openai', models: data.data?.map(m => m.id) || [] };
      }
    } catch { /* fall through */ }

    try {
      const resp = await fetch(`${config.baseUrl}/api/v1/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ model: config.model, input: '', context_length: 1 }),
        signal:  AbortSignal.timeout(7000),
      });
      if (resp.ok || resp.status < 500) {
        _detectedStyle = 'native';
        return { ok: true, style: 'native', models: [config.model] };
      }
    } catch { /* fall through */ }

    _detectedStyle = null;
    return { ok: false, error: 'No se pudo conectar al proxy en ' + config.baseUrl };
  }

  async function _post(endpoint, body, signal) {
    const resp = await fetch(`${config.baseUrl}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify(body),
      signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`LM Proxy ${resp.status}: ${txt.slice(0, 200)}`);
    }
    return resp.json();
  }

  function extractContent(data) {
    if (data.choices?.[0]?.message?.content)           return data.choices[0].message.content.trim();
    if (data.choices?.[0]?.message?.reasoning_content) return data.choices[0].message.reasoning_content.trim();
    if (data.choices?.[0]?.text)                       return data.choices[0].text.trim();
    if (typeof data.output === 'string')  return data.output.trim();
    if (Array.isArray(data.output))
      return data.output.map(b => typeof b === 'string' ? b : b.text || b.content || '').join('').trim();
    if (data.output?.text)    return data.output.text.trim();
    if (data.output?.content) return data.output.content.trim();
    if (typeof data.response === 'string') return data.response.trim();
    return JSON.stringify(data);
  }

  async function chat(messages, opts = {}) {
    if (!_detectedStyle) await checkConnection();
    const style = config.apiStyle !== 'auto' ? config.apiStyle : _detectedStyle;

    const data = style === 'native'
      ? await _post('/api/v1/chat', {
          model: opts.model || config.model,
          input: messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\nAssistant:',
          context_length: opts.contextLen || config.contextLen,
        }, opts.signal)
      : await _post('/v1/chat/completions', {
          model:       opts.model || config.model,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens:  opts.maxTokens  ?? 512,
        }, opts.signal);

    return extractContent(data);
  }

  async function chatStream(messages, opts = {}) {
    if (!_detectedStyle) await checkConnection();
    const style = config.apiStyle !== 'auto' ? config.apiStyle : _detectedStyle;

    if (style !== 'openai') return chat(messages, opts);

    const resp = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model:       opts.model || config.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens:  opts.maxTokens   ?? 512,
        stream:      true,
      }),
      signal: opts.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`LM Proxy ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') break;
        try {
          const d = JSON.parse(payload);
          const delta = d.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; opts.onToken?.(delta, full); }
        } catch (_) {}
      }
    }
    return full;
  }

  /* ── Bookmark-specific prompts ── */

  function describeBookmark(bookmark, signal) {
    return chat([
      { role: 'system', content: 'Eres un asistente que describe favoritos web de forma concisa. Responde SOLO con 1-2 frases en español describiendo el contenido basándote en el título y dominio. Sin introducción ni explicaciones extra.' },
      { role: 'user',   content: `Título: "${bookmark.title}"\nURL: ${bookmark.url}\nDominio: ${bookmark.domain || bookmark.baseDomain}\n\nDescribe brevemente el contenido de esta página.` },
    ], { maxTokens: 600, temperature: 0.3, signal });
  }

  /* ── Batch processing with bounded concurrency ── */

  async function processBookmarks(bookmarks, { onProgress, onUpdate, signal } = {}) {
    if (!_detectedStyle) await checkConnection();

    const total   = bookmarks.length;
    let processed = 0;
    let cancelled = false;

    async function processOne(bm) {
      if (cancelled || signal?.aborted) return;
      onProgress?.(++processed, total, bm);
      try {
        if (!bm.description) bm.description = await describeBookmark(bm, signal);
        onUpdate?.(bm);
      } catch (e) {
        if (signal?.aborted) { cancelled = true; return; }
        bm.description = bm.description || `(Error: ${e.message.slice(0, 60)})`;
        onUpdate?.(bm);
      }
    }

    const limit = config.concurrency;
    for (let i = 0; i < total; i += limit) {
      if (cancelled || signal?.aborted) break;
      await Promise.all(bookmarks.slice(i, i + limit).map(processOne));
    }
  }

  async function describeDomain(domain, bookmarks, signal) {
    const sample = bookmarks.slice(0, 10).map(b => `- ${b.title}`).join('\n');
    return chat([
      { role: 'system', content: 'Eres un asistente que describe dominios web. Responde SOLO con 1-2 frases en español describiendo qué tipo de contenido o servicio ofrece el dominio. Sin introducción ni explicaciones extra.' },
      { role: 'user',   content: `Dominio: ${domain}\n\nPáginas guardadas de este dominio:\n${sample}\n\nDescribe brevemente qué ofrece este dominio.` },
    ], { maxTokens: 120, temperature: 0.3, signal });
  }

  return { configure, getConfig, checkConnection, chat, chatStream, describeBookmark, processBookmarks, describeDomain };
})();
