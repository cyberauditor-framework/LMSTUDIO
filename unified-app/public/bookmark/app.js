(function () {
  'use strict';

  const VIEWS             = { FOLDERS: 'folders', DOMAINS: 'domains', TOPICS: 'topics' };
  const LOADING_OVERLAY_ID = '_db_loading';

  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */
  const State = {
    tree: null,
    domainTree: null,
    topicTree: null,
    flat: [],
    importCount: 0,
    activeView: VIEWS.FOLDERS,
    selectedId: null,
    expandedIds: new Set(),
    searchQuery: '',
    aiAbortCtrl: null,
  };

  /* ═══════════════════════════════════════════════════════════
     DOM REFERENCES
  ═══════════════════════════════════════════════════════════ */
  const $ = id => document.getElementById(id);
  const Dom = {
    fileInput:       $('file-input'),
    dbFileInput:     $('db-file-input'),
    btnAddUrl:       $('btn-add-url'),
    btnImport:       $('btn-import'),
    btnExportMd:     $('btn-export-md'),
    btnAiDescribe:   $('btn-ai-describe'),
    btnDomainExport: $('btn-domain-export'),
    btnDb:           $('btn-db'),
    aiStatus:        $('ai-status'),
    aiDot:           $('ai-dot'),
    aiStatusText:    $('ai-status-text'),
    dropOverlay:     $('drop-overlay'),
    treeContainer:   $('tree-container'),
    emptyState:      $('empty-state'),
    treeStats:       $('tree-stats'),
    searchInput:     $('search-input'),
    toggleFolders:   $('toggle-folders'),
    toggleDomains:   $('toggle-domains'),
    toggleTopics:    $('toggle-topics'),
    contentArea:     $('content-area'),
    welcomeScreen:   $('welcome-screen'),
    bookmarkDetail:  $('bookmark-detail'),
    panelLeft:       $('panel-left'),
    resizeHandle:    $('resize-handle'),
    // AI modal
    modalOverlay:    $('modal-overlay'),
    modalTitle:      $('modal-title'),
    progressBar:     $('progress-bar'),
    progressText:    $('progress-text'),
    btnCancelAi:     $('btn-cancel-ai'),
    // LM config modal
    configModal:     $('config-modal-overlay'),
    configUrl:       $('config-url'),
    configModel:     $('config-model'),
    configToken:     $('config-token'),
    btnSaveConfig:   $('btn-save-config'),
    btnCloseConfig:  $('btn-close-config'),
    // Add manual URL modal
    addUrlModal:       $('add-url-modal-overlay'),
    manualUrlInput:    $('manual-url-input'),
    manualTitleInput:  $('manual-title-input'),
    manualFolderInput: $('manual-folder-input'),
    manualDescribe:    $('manual-describe-check'),
    btnSaveManualUrl:  $('btn-save-manual-url'),
    btnCloseManualUrl: $('btn-close-manual-url'),
    // DB modal
    dbModal:         $('db-modal-overlay'),
    btnCloseDb:      $('btn-close-db'),
    btnExportDb:     $('btn-export-db'),
    btnImportDb:     $('btn-import-db'),
    btnClearDb:      $('btn-clear-db'),
    importHistory:   $('import-history'),
    dbStatTotal:     $('db-stat-total'),
    dbStatDomains:   $('db-stat-domains'),
    dbStatAi:        $('db-stat-ai'),
    dbStatFiles:     $('db-stat-files'),
  };

  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */
  async function init() {
    showDbLoading(true);
    try {
      await BookmarkDB.open();
      await loadFromDB();
    } catch (e) {
      console.error('DB init error:', e);
      toast('Error abriendo base de datos: ' + e.message, 'error');
    } finally {
      showDbLoading(false);
    }
    bindEvents();
    checkAIConnection();
  }

  /* ═══════════════════════════════════════════════════════════
     LOAD FROM DB ON STARTUP
  ═══════════════════════════════════════════════════════════ */
  async function loadFromDB() {
    const [bookmarks, imports] = await Promise.all([
      BookmarkDB.getAllBookmarks(),
      BookmarkDB.getAllImports(),
    ]);
    if (bookmarks.length === 0) return;

    State.flat        = bookmarks;
    State.importCount = imports.length;
    enrichSimilarDomains(State.flat);
    rebuildTrees();
    renderAll();
    toast(`Cargados ${bookmarks.length} favoritos desde la base de datos`, 'success', 2500);
  }

  /* ═══════════════════════════════════════════════════════════
     EVENTS
  ═══════════════════════════════════════════════════════════ */
  function bindEvents() {
    // Add URL manually
    Dom.btnAddUrl.addEventListener('click', openManualUrlModal);
    Dom.btnSaveManualUrl.addEventListener('click', addManualUrl);
    Dom.btnCloseManualUrl.addEventListener('click', closeManualUrlModal);

    // Submit modal with Enter in URL field
    Dom.manualUrlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addManualUrl();
      }
    });

    // Import HTML bookmarks
    Dom.btnImport.addEventListener('click', () => Dom.fileInput.click());
    Dom.fileInput.addEventListener('change', e => { handleFiles(e.target.files); Dom.fileInput.value = ''; });

    // Drag & drop
    document.addEventListener('dragover', e => { e.preventDefault(); Dom.dropOverlay.classList.remove('hidden'); });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) Dom.dropOverlay.classList.add('hidden'); });
    document.addEventListener('drop', e => {
      e.preventDefault();
      Dom.dropOverlay.classList.add('hidden');
      handleFiles(e.dataTransfer.files);
    });

    // Markdown export
    Dom.btnExportMd.addEventListener('click', exportMarkdown);
    Dom.btnDomainExport.addEventListener('click', exportMarkdown);

    // AI
    Dom.btnAiDescribe.addEventListener('click', startAIProcessing);
    Dom.btnCancelAi.addEventListener('click', () => { State.aiAbortCtrl?.abort(); hideModal(); });

    // Search — debounced to avoid re-rendering on every keystroke
    let _searchTimer;
    Dom.searchInput.addEventListener('input', e => {
      clearTimeout(_searchTimer);
      const q = e.target.value.toLowerCase();
      _searchTimer = setTimeout(() => { State.searchQuery = q; renderTree(); }, 250);
    });

    // View toggles
    Dom.toggleFolders.addEventListener('click', () => setView(VIEWS.FOLDERS));
    Dom.toggleDomains.addEventListener('click', () => setView(VIEWS.DOMAINS));
    Dom.toggleTopics.addEventListener('click',  () => setView(VIEWS.TOPICS));

    // LM config
    Dom.aiStatus.addEventListener('click', () => { Dom.configModal.style.display = 'flex'; });
    Dom.btnSaveConfig.addEventListener('click', saveAIConfig);
    Dom.btnCloseConfig.addEventListener('click', () => { Dom.configModal.style.display = 'none'; });

    // DB modal
    Dom.btnDb.addEventListener('click', openDbModal);
    Dom.btnCloseDb.addEventListener('click', () => { Dom.dbModal.style.display = 'none'; });
    Dom.btnExportDb.addEventListener('click', exportDB);
    Dom.btnImportDb.addEventListener('click', () => Dom.dbFileInput.click());
    Dom.dbFileInput.addEventListener('change', e => { restoreDB(e.target.files[0]); Dom.dbFileInput.value = ''; });
    Dom.btnClearDb.addEventListener('click', clearDB);

    // Import history: delete via event delegation (avoids leaky App._deleteImport)
    Dom.importHistory.addEventListener('click', async e => {
      const btn = e.target.closest('.import-item-del');
      if (!btn) return;
      const id = Number(btn.dataset.importId);
      await BookmarkDB.deleteImport(id);
      State.importCount = Math.max(0, State.importCount - 1);
      await refreshDbModal();
    });

    // Close modals on backdrop click
    [Dom.dbModal, Dom.configModal, Dom.addUrlModal].forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
    });

    // Resize
    initResizeHandle();
  }

  function openManualUrlModal() {
    Dom.manualUrlInput.value = '';
    Dom.manualTitleInput.value = '';
    Dom.manualFolderInput.value = '';
    Dom.manualDescribe.checked = true;
    Dom.addUrlModal.style.display = 'flex';
    setTimeout(() => Dom.manualUrlInput.focus(), 0);
  }

  function closeManualUrlModal() {
    Dom.addUrlModal.style.display = 'none';
    Dom.btnSaveManualUrl.disabled = false;
    Dom.btnSaveManualUrl.textContent = 'Guardar URL';
  }

  async function addManualUrl() {
    const rawUrl = Dom.manualUrlInput.value.trim();
    if (!rawUrl) {
      toast('Introduce una URL para guardar.', 'warning');
      Dom.manualUrlInput.focus();
      return;
    }

    const finalUrl = normalizeInputUrl(rawUrl);
    if (!isHttpUrl(finalUrl)) {
      toast('URL no válida. Usa una URL http o https.', 'error');
      Dom.manualUrlInput.focus();
      return;
    }

    const urlNorm = BookmarkDB.normaliseUrl(finalUrl);
    const existing = State.flat.find(b => BookmarkDB.normaliseUrl(b.url) === urlNorm);
    if (existing) {
      toast('Esa URL ya existe en tus favoritos.', 'warning');
      closeManualUrlModal();
      App.selectById(existing.id);
      return;
    }

    const bm = {
      id: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type: 'bookmark',
      title: Dom.manualTitleInput.value.trim() || titleFromUrl(finalUrl),
      url: finalUrl,
      urlNorm,
      favicon: faviconUrl(finalUrl),
      addDate: Date.now(),
      folder: Dom.manualFolderInput.value.trim() || 'Añadidos manualmente',
      description: '',
      domain: extractDomain(finalUrl),
      baseDomain: extractBaseDomain(finalUrl),
      sourceFile: 'manual',
      savedAt: Date.now(),
    };

    const withDescription = Dom.manualDescribe.checked;
    Dom.btnSaveManualUrl.disabled = true;
    Dom.btnSaveManualUrl.textContent = withDescription ? 'Guardando y describiendo...' : 'Guardando...';

    try {
      const { added, skipped } = await BookmarkDB.saveBookmarks([bm]);
      if (added === 0 || skipped > 0) {
        toast('La URL no se añadió porque ya existía.', 'warning');
        closeManualUrlModal();
        return;
      }

      State.flat.push(bm);

      if (withDescription) {
        try {
          bm.description = await LMClient.describeBookmark(bm);
          await BookmarkDB.updateBookmark(bm);
        } catch (e) {
          toast('URL guardada, pero no se pudo generar descripción IA.', 'warning');
          console.warn('AI description error for manual URL:', e);
        }
      }

      enrichSimilarDomains(State.flat);
      rebuildTrees();
      renderAll();
      State.selectedId = bm.id;
      showBookmarkDetail(bm);
      renderTree();

      toast(withDescription && bm.description
        ? 'URL añadida y descrita con IA.'
        : 'URL añadida correctamente.',
      'success');
      closeManualUrlModal();
    } catch (e) {
      toast('Error al guardar URL: ' + e.message, 'error');
      Dom.btnSaveManualUrl.disabled = false;
      Dom.btnSaveManualUrl.textContent = 'Guardar URL';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     FILE HANDLING  (multi-file + dedup)
  ═══════════════════════════════════════════════════════════ */
  async function handleFiles(files) {
    if (!files || files.length === 0) return;

    const htmlFiles = Array.from(files).filter(f => /\.html?$/i.test(f.name));
    if (htmlFiles.length === 0) {
      toast('Selecciona archivos HTML exportados de favoritos.', 'warning');
      return;
    }

    showDbLoading(true, `Procesando ${htmlFiles.length} archivo(s)...`);

    try {
      let totalAdded = 0, totalSkipped = 0;

      for (const file of htmlFiles) {
        const html = await readFile(file);
        const result = BookmarkParser.parse([html]);
        const newBookmarks = result.flat.map(bm => ({ ...bm, sourceFile: file.name }));

        // Persist to DB (dedup by normalised URL)
        const { added, skipped } = await BookmarkDB.saveBookmarks(newBookmarks);

        // Save import record
        await BookmarkDB.saveImport({
          filename:    file.name,
          importedAt:  new Date().toISOString(),
          added,
          skipped,
          totalInFile: newBookmarks.length,
        });

        totalAdded   += added;
        totalSkipped += skipped;
        State.importCount++;
      }

      // Reload from DB once — single source of truth after all files processed
      State.flat = await BookmarkDB.getAllBookmarks();
      enrichSimilarDomains(State.flat);
      rebuildTrees();
      renderAll();

      // Result notification
      const parts = [`✓ ${totalAdded} favorito${totalAdded !== 1 ? 's' : ''} añadido${totalAdded !== 1 ? 's' : ''}`];
      if (totalSkipped > 0) parts.push(`${totalSkipped} duplicado${totalSkipped !== 1 ? 's' : ''} omitido${totalSkipped !== 1 ? 's' : ''}`);
      toast(parts.join(' · '), totalAdded > 0 ? 'success' : 'warning');

    } catch (e) {
      console.error('Import error:', e);
      toast('Error al importar: ' + e.message, 'error');
    } finally {
      showDbLoading(false);
    }
  }

  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = rej;
      r.readAsText(file, 'UTF-8');
    });
  }

  /* ═══════════════════════════════════════════════════════════
     TREE REBUILD FROM FLAT LIST
  ═══════════════════════════════════════════════════════════ */
  function rebuildTrees() {
    // Reconstruct folder tree from the flat bookmarks' .folder paths
    State.tree       = buildFolderTreeFromFlat(State.flat);
    State.domainTree = BookmarkParser.buildDomainTree(State.flat);
    State.topicTree  = BookmarkParser.buildTopicTree(State.flat);
    State.expandedIds.add(State.tree.id);
  }

  function buildFolderTreeFromFlat(bookmarks) {
    const root      = { id: 'root', type: 'folder', title: 'Favoritos', children: [], path: '' };
    const folderMap = { '': root };
    // ensureFolder is recursive, so no pre-sort needed — parent folders are created on demand.
    for (const bm of bookmarks) {
      ensureFolder(bm.folder || '', folderMap);
      folderMap[bm.folder || ''].children.push(bm);
    }
    return root;
  }

  // djb2 hash — stable (same path → same id), no truncation collisions.
  function hashPath(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
    return 'f' + (h >>> 0).toString(36);
  }

  function ensureFolder(path, map) {
    if (map[path]) return map[path];
    const parts = path.split(' / ');
    const title = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join(' / ');
    ensureFolder(parentPath, map);

    const node = {
      id: 'folder-' + hashPath(path),
      type: 'folder',
      title,
      path,
      children: [],
    };
    map[path] = node;
    map[parentPath].children.push(node);
    return node;
  }

  function enrichSimilarDomains(bookmarks) {
    const domainMap = {};
    for (const bm of bookmarks) {
      if (!bm.baseDomain) continue;
      if (!domainMap[bm.baseDomain]) domainMap[bm.baseDomain] = [];
      domainMap[bm.baseDomain].push(bm);
    }
    for (const bm of bookmarks) {
      bm.similarDomain = (domainMap[bm.baseDomain] || []).filter(b => b.id !== bm.id);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER ORCHESTRATION
  ═══════════════════════════════════════════════════════════ */
  function renderAll() {
    renderStats();
    renderTree();
    Dom.emptyState.style.display   = 'none';
    Dom.btnExportMd.disabled       = false;
    Dom.btnAiDescribe.disabled     = false;
    Dom.btnDomainExport.disabled   = false;
  }

  function computeStats() {
    return BookmarkDB.computeStats(State.flat, State.importCount);
  }

  function renderStats() {
    const s = computeStats();
    Dom.treeStats.textContent = `${s.total} favoritos · ${s.domains} dominios · ${s.withDescription} con IA`;
  }

  /* ═══════════════════════════════════════════════════════════
     TREE VIEW
  ═══════════════════════════════════════════════════════════ */
  function setView(view) {
    State.activeView = view;
    [Dom.toggleFolders, Dom.toggleDomains, Dom.toggleTopics].forEach(b => b.classList.remove('active'));
    ({ [VIEWS.FOLDERS]: Dom.toggleFolders, [VIEWS.DOMAINS]: Dom.toggleDomains, [VIEWS.TOPICS]: Dom.toggleTopics })[view]?.classList.add('active');
    renderTree();
  }

  function getActiveTree() {
    if (State.activeView === VIEWS.DOMAINS) return State.domainTree;
    if (State.activeView === VIEWS.TOPICS)  return State.topicTree;
    return State.tree;
  }

  function renderTree() {
    const root = getActiveTree();
    if (!root) return;
    const query    = State.searchQuery;
    const filtered = query ? filterTree(root, query) : root;
    Dom.treeContainer.innerHTML = '';
    if (!filtered) {
      Dom.treeContainer.innerHTML = `<div class="empty-state empty-state-compact"><p>Sin resultados para "${escHtml(query)}"</p></div>`;
      return;
    }
    Dom.treeContainer.appendChild(buildTreeNode(filtered, true));
  }

  function filterTree(node, query) {
    if (node.type === 'bookmark') {
      return (node.title.toLowerCase().includes(query) ||
              node.url.toLowerCase().includes(query) ||
              node.description?.toLowerCase().includes(query)) ? node : null;
    }
    const filteredChildren = (node.children || []).map(c => filterTree(c, query)).filter(Boolean);
    return filteredChildren.length ? { ...node, children: filteredChildren } : null;
  }

  function buildTreeNode(node, isRoot) {
    if (node.type === 'bookmark') return buildLeaf(node);

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';
    wrapper.dataset.id = node.id;

    if (!isRoot) wrapper.appendChild(buildFolderHeader(node));

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-node-children' + (isRoot || State.expandedIds.has(node.id) ? '' : ' collapsed');
    childContainer.id = 'children-' + node.id;

    for (const child of (node.children || [])) childContainer.appendChild(buildTreeNode(child, false));
    wrapper.appendChild(childContainer);
    return wrapper;
  }

  function buildFolderHeader(node) {
    const header = document.createElement('div');
    header.className = 'tree-node-header' + (State.selectedId === node.id ? ' active' : '');

    const toggle = document.createElement('span');
    toggle.className = 'node-toggle' + (State.expandedIds.has(node.id) ? ' open' : '');
    toggle.textContent = '▶';

    const icon = document.createElement('span');
    icon.className = 'node-icon';
    icon.textContent = node.isDomainGroup ? '🌐' : node.isTopicGroup ? '🏷️' : '📁';

    const title = document.createElement('span');
    title.className = 'node-title';
    title.innerHTML = highlightQuery(escHtml(node.title));

    const count = document.createElement('span');
    count.className = 'node-count';
    count.textContent = countLeaves(node);

    header.append(toggle, icon, title, count);
    header.addEventListener('click', () => {
      const expanded = State.expandedIds.has(node.id);
      if (expanded) State.expandedIds.delete(node.id); else State.expandedIds.add(node.id);
      State.selectedId = node.id;
      toggle.classList.toggle('open', !expanded);
      const cc = document.getElementById('children-' + node.id);
      if (cc) cc.classList.toggle('collapsed', expanded);
      document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
      header.classList.add('active');
      showFolderDetail(node);
    });
    return header;
  }

  function buildLeaf(bm) {
    const leaf = document.createElement('div');
    leaf.className = 'tree-leaf' + (State.selectedId === bm.id ? ' active' : '');
    leaf.dataset.id = bm.id;

    const img = document.createElement('img');
    img.className = 'leaf-favicon';
    img.src = bm.favicon || ''; img.alt = '';
    img.onerror = () => { img.style.display = 'none'; };

    const title = document.createElement('span');
    title.className = 'leaf-title';
    title.innerHTML = highlightQuery(escHtml(bm.title));

    leaf.append(img, title);

    if (bm.description) {
      const badge = document.createElement('span');
      badge.className = 'leaf-ai-badge'; badge.textContent = '✦'; badge.title = 'Tiene descripción IA';
      leaf.appendChild(badge);
    }

    leaf.addEventListener('click', () => {
      document.querySelectorAll('.tree-leaf').forEach(l => l.classList.remove('active'));
      leaf.classList.add('active');
      State.selectedId = bm.id;
      showBookmarkDetail(bm);
    });
    return leaf;
  }

  /* ═══════════════════════════════════════════════════════════
     DETAIL PANELS
  ═══════════════════════════════════════════════════════════ */
  function showBookmarkDetail(bm) {
    Dom.welcomeScreen.style.display  = 'none';
    Dom.bookmarkDetail.style.display = 'block';
    Dom.bookmarkDetail.innerHTML = `
      <div class="detail-breadcrumb">
        ${bm.folder
          ? bm.folder.split(' / ').map((p, i, arr) =>
              `<span class="breadcrumb-item">${escHtml(p)}</span>${i < arr.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ''}`
            ).join('')
          : '<span class="breadcrumb-item">Raíz</span>'}
        ${bm.sourceFile ? `<span class="breadcrumb-sep">·</span><span class="leaf-source" title="Archivo origen">${escHtml(bm.sourceFile)}</span>` : ''}
      </div>

      <div class="detail-header">
        <div class="detail-title">
          <img class="detail-favicon" src="${escHtml(bm.favicon || '')}" alt="" onerror="this.style.display='none'" />
          ${escHtml(bm.title)}
        </div>
        <a href="${escHtml(bm.url)}" target="_blank" rel="noopener" class="detail-url">
          🔗 ${escHtml(bm.url)}
        </a>
        <div class="detail-meta">
          <span class="meta-chip domain">${escHtml(bm.baseDomain || bm.domain || 'desconocido')}</span>
          ${bm.addDate ? `<span class="meta-chip">📅 ${new Date(bm.addDate).toLocaleDateString('es-ES')}</span>` : ''}
          ${bm.folder ? `<span class="meta-chip">📁 ${escHtml(bm.folder.split(' / ').pop())}</span>` : ''}
          ${bm.sourceFile ? `<span class="meta-chip">📄 ${escHtml(bm.sourceFile)}</span>` : ''}
        </div>
      </div>

      <div class="detail-section">
        <div class="section-label">Descripción</div>
        <div class="section-body" id="desc-body">
          ${bm.description
            ? escHtml(bm.description)
            : `<span class="text-muted-italic">Sin descripción — usa "Describir con IA" para generarla.</span>`}
        </div>
      </div>

      <div class="detail-section">
        <div class="section-label">Acciones</div>
        <div class="detail-actions">
          <button class="btn btn-ai" onclick="App.describeOne('${escAttr(bm.id)}')">✦ Describir con IA</button>
          <a href="${escHtml(bm.url)}" target="_blank" rel="noopener" class="btn btn-secondary">↗ Abrir URL</a>
        </div>
      </div>

      ${bm.similarDomain?.length ? `
      <div class="detail-section">
        <div class="section-label">Mismo dominio (${bm.similarDomain.length})</div>
        <div class="similar-list">
          ${bm.similarDomain.slice(0, 8).map(s => `
            <div class="similar-item" onclick="App.selectById('${escAttr(s.id)}')">
              <img class="similar-item-favicon" src="${escHtml(s.favicon || '')}" onerror="this.style.display='none'" />
              <span class="similar-item-title">${escHtml(s.title)}</span>
              <span class="similar-item-domain">${escHtml(s.folder?.split(' / ').pop() || '')}</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
    `;
  }

  function showFolderDetail(node) {
    Dom.welcomeScreen.style.display  = 'none';
    Dom.bookmarkDetail.style.display = 'block';

    const leaves = [];
    collectLeaves(node, leaves);

    const pending = leaves.filter(b => !b.description).length;

    // Group by sourceFile for the folder view
    const sources = [...new Set(leaves.map(b => b.sourceFile).filter(Boolean))];
    const sourceLine = sources.length > 1
      ? `<div class="dedup-banner">⚠ Favoritos de ${sources.length} archivos diferentes: ${sources.map(s => escHtml(s)).join(', ')}</div>`
      : '';

    Dom.bookmarkDetail.innerHTML = `
      <div class="folder-view">
        <div class="folder-header">
          <div class="folder-icon">${node.isDomainGroup ? '🌐' : node.isTopicGroup ? '🏷️' : '📁'}</div>
          <div class="folder-info">
            <h2>${escHtml(node.title)}</h2>
            <p>${leaves.length} favorito${leaves.length !== 1 ? 's' : ''}${pending > 0 ? ` · <span class="text-muted">${pending} sin descripción</span>` : ''}</p>
          </div>
          <button class="btn btn-ai btn-align-end" onclick="App.describeNode('${escAttr(node.id)}')">✦ Describir con IA</button>
        </div>
        ${sourceLine}
        <div class="bookmarks-grid">
          ${leaves.map(bm => `
            <div class="bookmark-card" onclick="App.selectById('${escAttr(bm.id)}')">
              <div class="card-header">
                <img class="card-favicon" src="${escHtml(bm.favicon || '')}" alt="" onerror="this.style.display='none'" />
                <span class="card-title" title="${escHtml(bm.title)}">${escHtml(bm.title)}</span>
                ${bm.description ? '<span class="card-ai-badge">✦</span>' : ''}
              </div>
              ${bm.description
                ? `<div class="card-desc">${escHtml(bm.description)}</div>`
                : `<div class="card-desc card-desc-muted">Sin descripción</div>`}
              <div class="card-domain">${escHtml(bm.baseDomain || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function findNodeById(node, id) {
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const found = findNodeById(c, id);
      if (found) return found;
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API (called from inline HTML)
  ═══════════════════════════════════════════════════════════ */
  const App = {
    selectById(id) {
      const bm = State.flat.find(b => b.id === id);
      if (bm) {
        State.selectedId = id;
        showBookmarkDetail(bm);
        document.querySelectorAll('.tree-leaf').forEach(l => l.classList.toggle('active', l.dataset.id === id));
      }
    },

    async describeNode(nodeId) {
      const root = State.activeView === VIEWS.DOMAINS ? State.domainTree
                 : State.activeView === VIEWS.TOPICS  ? State.topicTree
                 : State.tree;
      const node = findNodeById(root, nodeId);
      if (!node) return;

      const leaves = [];
      collectLeaves(node, leaves);
      const missing = leaves.filter(b => !b.description);
      if (missing.length === 0) {
        toast('Todos los favoritos de este grupo ya tienen descripción.', 'warning');
        return;
      }

      showModal(`✦ Procesando ${missing.length} favoritos con IA...`);
      setProgress(0, missing.length);
      State.aiAbortCtrl = new AbortController();

      await LMClient.processBookmarks(missing, {
        signal: State.aiAbortCtrl.signal,
        onProgress(current, total, bm) {
          setProgress(current, total);
          Dom.progressText.textContent = `[${current}/${total}] ${bm.title.slice(0, 60)}`;
        },
        async onUpdate(bm) {
          await BookmarkDB.updateBookmark(bm);
          renderStats();
          updateLeafBadge(bm.id);
        },
      });

      hideModal();
      renderStats();
      showFolderDetail(node);
    },

    async describeOne(id) {
      const bm = State.flat.find(b => b.id === id);
      if (!bm) return;
      if (bm.description) { toast('Este favorito ya tiene descripción.', 'warning'); return; }

      const descBody = document.getElementById('desc-body');
      if (descBody) { descBody.className = 'section-body loading'; descBody.textContent = 'Generando descripción...'; }

      try {
        bm.description = await LMClient.describeBookmark(bm);

        // Persist to DB
        await BookmarkDB.updateBookmark(bm);

        showBookmarkDetail(bm);
        renderStats();
        updateLeafBadge(id);
      } catch (e) {
        if (descBody) { descBody.className = 'section-body'; descBody.textContent = 'Error: ' + e.message; }
      }
    },
  };

  window.App = App;

  /* ═══════════════════════════════════════════════════════════
     AI BATCH PROCESSING
  ═══════════════════════════════════════════════════════════ */
  async function startAIProcessing() {
    if (State.flat.length === 0) return;
    const missing = State.flat.filter(b => !b.description);
    if (missing.length === 0) { toast('Todos los favoritos ya tienen descripción.', 'warning'); return; }

    showModal(`✦ Procesando ${missing.length} favoritos con IA...`);
    setProgress(0, missing.length);
    State.aiAbortCtrl = new AbortController();

    await LMClient.processBookmarks(missing, {
      signal: State.aiAbortCtrl.signal,
      onProgress(current, total, bm) {
        setProgress(current, total);
        Dom.progressText.textContent = `[${current}/${total}] ${bm.title.slice(0, 60)}`;
      },
      async onUpdate(bm) {
        await BookmarkDB.updateBookmark(bm);
        if (State.selectedId === bm.id) showBookmarkDetail(bm);
        renderStats();
        updateLeafBadge(bm.id);
      },
    });

    hideModal();
    renderStats();
    const bm = State.flat.find(b => b.id === State.selectedId);
    if (bm) showBookmarkDetail(bm);
  }

  function updateLeafBadge(id) {
    const leafEl = Dom.treeContainer.querySelector(`.tree-leaf[data-id="${id}"]`);
    if (leafEl && !leafEl.querySelector('.leaf-ai-badge')) {
      const badge = document.createElement('span');
      badge.className = 'leaf-ai-badge'; badge.textContent = '✦';
      leafEl.appendChild(badge);
    }
  }

  function showModal(title) { Dom.modalTitle.textContent = title; Dom.modalOverlay.style.display = 'flex'; }
  function hideModal()      { Dom.modalOverlay.style.display = 'none'; }
  function setProgress(cur, total) { Dom.progressBar.style.width = (total ? Math.round(cur / total * 100) : 0) + '%'; }

  /* ═══════════════════════════════════════════════════════════
     DATABASE MODAL
  ═══════════════════════════════════════════════════════════ */
  async function openDbModal() {
    Dom.dbModal.style.display = 'flex';
    await refreshDbModal();
  }

  async function refreshDbModal() {
    // Stats come from in-memory State.flat — no extra DB read needed.
    const s = computeStats();
    Dom.dbStatTotal.textContent   = s.total;
    Dom.dbStatDomains.textContent = s.domains;
    Dom.dbStatAi.textContent      = s.withDescription;

    const imports = await BookmarkDB.getAllImports();
    State.importCount = imports.length;
    Dom.dbStatFiles.textContent = imports.length;
    renderImportHistory([...imports].reverse()); // newest first
  }

  function renderImportHistory(imports) {
    if (imports.length === 0) {
      Dom.importHistory.innerHTML = '<div class="import-empty">Sin importaciones registradas.</div>';
      return;
    }

    Dom.importHistory.innerHTML = imports.map(imp => {
      const date = new Date(imp.importedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div class="import-item" id="imp-${imp.id}">
          <span class="import-item-icon">📄</span>
          <div class="import-item-info">
            <div class="import-item-name" title="${escHtml(imp.filename)}">${escHtml(imp.filename)}</div>
            <div class="import-item-meta">${date} · ${imp.totalInFile} en archivo</div>
          </div>
          <span class="import-badge added" title="Favoritos nuevos añadidos">+${imp.added}</span>
          ${imp.skipped > 0 ? `<span class="import-badge skipped" title="Duplicados omitidos">${imp.skipped} dup.</span>` : ''}
          <button class="import-item-del" title="Eliminar registro" data-import-id="${imp.id}">✕</button>
        </div>
      `;
    }).join('');
  }


  /* ═══════════════════════════════════════════════════════════
     DB EXPORT / IMPORT / CLEAR
  ═══════════════════════════════════════════════════════════ */
  async function exportDB() {
    try {
      const json = await BookmarkDB.exportJSON();
      const now  = new Date().toISOString().slice(0, 10);
      downloadFile(`bookmarks-db-${now}.json`, json, 'application/json');
      toast('Base de datos exportada correctamente', 'success');
    } catch (e) {
      toast('Error al exportar: ' + e.message, 'error');
    }
  }

  async function restoreDB(file) {
    if (!file) return;
    if (!confirm(`¿Restaurar la base de datos desde "${file.name}"?\nEsto REEMPLAZARÁ todos los datos actuales.`)) return;

    showDbLoading(true, 'Restaurando base de datos...');
    try {
      const json   = await readFile(file);
      const result = await BookmarkDB.importJSON(json);
      const [bookmarks, imports] = await Promise.all([
        BookmarkDB.getAllBookmarks(),
        BookmarkDB.getAllImports(),
      ]);
      State.flat        = bookmarks;
      State.importCount = imports.length;
      enrichSimilarDomains(State.flat);
      rebuildTrees();
      if (State.flat.length > 0) renderAll();
      Dom.dbModal.style.display = 'none';
      toast(`Restaurados ${result.bookmarks} favoritos e historial de ${result.imports} importaciones`, 'success');
    } catch (e) {
      toast('Error al restaurar: ' + e.message, 'error');
    } finally {
      showDbLoading(false);
    }
  }

  async function clearDB() {
    if (!confirm('¿Vaciar TODA la base de datos?\nSe eliminarán todos los favoritos y el historial. Esta acción no se puede deshacer.')) return;
    try {
      await BookmarkDB.clearAll();
      State.flat = []; State.tree = null; State.domainTree = null; State.topicTree = null; State.selectedId = null;
      Dom.treeContainer.innerHTML = '';
      Dom.emptyState.style.display   = 'flex';
      Dom.welcomeScreen.style.display = 'flex';
      Dom.bookmarkDetail.style.display = 'none';
      Dom.treeStats.textContent = '';
      Dom.btnExportMd.disabled = true;
      Dom.btnAiDescribe.disabled = true;
      Dom.dbModal.style.display = 'none';
      Dom.emptyState.style.display = '';
      Dom.treeContainer.appendChild(Dom.emptyState);
      toast('Base de datos vaciada', 'warning');
    } catch (e) {
      toast('Error al vaciar: ' + e.message, 'error');
    }
  }

  /* ═══════════════════════════════════════════════════════════
     AI CONNECTION
  ═══════════════════════════════════════════════════════════ */
  async function checkAIConnection() {
    Dom.aiDot.className = 'ai-dot loading';
    Dom.aiStatusText.textContent = 'Conectando...';
    const result = await LMClient.checkConnection();
    Dom.aiDot.className  = result.ok ? 'ai-dot connected' : 'ai-dot error';
    Dom.aiStatusText.textContent = result.ok ? 'LM Studio ✓' : 'LM Studio ✗';
  }

  function saveAIConfig() {
    LMClient.configure({
      baseUrl: Dom.configUrl.value.trim().replace(/\/$/, ''),
      model:   Dom.configModel.value.trim(),
      token:   Dom.configToken.value.trim(),
    });
    Dom.configModal.style.display = 'none';
    checkAIConnection();
  }

  /* ═══════════════════════════════════════════════════════════
     MARKDOWN EXPORT
  ═══════════════════════════════════════════════════════════ */
  function exportMarkdown() {
    if (!State.tree || State.flat.length === 0) return;
    const groups = buildDomainGroups();
    const md     = generateDomainMarkdown(groups);
    const now    = new Date().toISOString().slice(0, 10);
    downloadFile(`favoritos-${now}.md`, md, 'text/markdown');
  }

  /* ═══════════════════════════════════════════════════════════
     RESIZE HANDLE
  ═══════════════════════════════════════════════════════════ */
  function initResizeHandle() {
    const handle = Dom.resizeHandle;
    let dragging = false, startX = 0, startW = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true; startX = e.clientX; startW = Dom.panelLeft.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      Dom.panelLeft.style.width = Math.max(180, Math.min(startW + (e.clientX - startX), window.innerWidth * 0.6)) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = document.body.style.userSelect = '';
    });
  }

  /* ═══════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════ */
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(str) { return escHtml(str).replace(/'/g, '&#39;'); }

  function highlightQuery(html) {
    if (!State.searchQuery) return html;
    return html.replace(new RegExp(escHtml(State.searchQuery), 'gi'), m => `<mark class="highlight">${m}</mark>`);
  }

  function normalizeInputUrl(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }

  function isHttpUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function titleFromUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname && u.pathname !== '/' ? u.pathname.split('/').filter(Boolean).pop() : '';
      return path ? `${u.hostname} / ${decodeURIComponent(path).slice(0, 60)}` : u.hostname;
    } catch {
      return url;
    }
  }

  function extractDomain(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function extractBaseDomain(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      if (parts.length > 2 && parts[parts.length - 2].length <= 3) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    } catch {
      return '';
    }
  }

  function faviconUrl(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}/favicon.ico`;
    } catch {
      return '';
    }
  }

  const { collectBookmarks: collectLeaves, countLeaves } = BookmarkParser;

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ── Toast notifications ── */
  function toast(msg, type = 'success', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✗' : '⚠'}</span> ${escHtml(msg)}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /* ── DB loading overlay ── */
  function showDbLoading(show, msg = 'Cargando base de datos...') {
    let el = document.getElementById(LOADING_OVERLAY_ID);
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = LOADING_OVERLAY_ID; el.className = 'db-loading';
        el.innerHTML = `<div class="db-loading-box"><div class="db-spinner"></div><p>${escHtml(msg)}</p></div>`;
        document.body.appendChild(el);
      } else {
        el.querySelector('p').textContent = msg;
      }
    } else {
      el?.remove();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DOMAIN EXPORT
  ═══════════════════════════════════════════════════════════ */

  /**
   * Build deduplicated domain groups from State.flat.
   * - One URL per normalised URL (first occurrence wins)
   * - One domain per baseDomain
   * - Empty domains excluded
   * - Sorted alphabetically by domain name
   */
  function buildDomainGroups() {
    const seenNorms = new Set();
    const groups    = {};                 // baseDomain → { domain, bookmarks[] }

    for (const bm of State.flat) {
      if (!bm.url || !bm.baseDomain) continue;
      const norm = BookmarkDB.normaliseUrl(bm.url);
      if (seenNorms.has(norm)) continue;
      seenNorms.add(norm);

      if (!groups[bm.baseDomain]) groups[bm.baseDomain] = { domain: bm.baseDomain, bookmarks: [], description: '' };
      groups[bm.baseDomain].bookmarks.push(bm);
    }

    return Object.values(groups)
      .filter(g => g.bookmarks.length > 0)
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }

  /**
   * Generate enriched markdown from domain groups.
   * Sections sorted A→Z; within each domain, bookmarks grouped by folder then sorted by title.
   */
  function generateDomainMarkdown(groups) {
    const lines    = [];
    const now      = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    const totalUrl = groups.reduce((s, g) => s + g.bookmarks.length, 0);

    /* ── Header ── */
    lines.push('# Favoritos por Dominio');
    lines.push('');
    lines.push(`> Generado el **${now}** · ${totalUrl} URLs únicas · ${groups.length} dominios`);
    lines.push('');
    lines.push('---');
    lines.push('');

    /* ── Domain sections ── */
    for (const g of groups) {
      lines.push(`## 🌐 ${g.domain}`);
      lines.push('');

      // Within each domain: group by folder, sort folders and titles
      const folderMap = {};
      for (const bm of g.bookmarks) {
        const f = bm.folder || '';
        if (!folderMap[f]) folderMap[f] = [];
        folderMap[f].push(bm);
      }
      const sortedFolders = Object.keys(folderMap).sort((a, b) => a.localeCompare(b));
      const multiFolder   = sortedFolders.length > 1;

      for (const folder of sortedFolders) {
        if (multiFolder) {
          lines.push(`### 📁 ${folder || 'Sin carpeta'}`);
          lines.push('');
        }

        const sortedBms = folderMap[folder].slice().sort((a, b) => a.title.localeCompare(b.title));

        for (const bm of sortedBms) {
          if (bm.description) {
            lines.push(`- **[${bm.title}](${bm.url})**`);
            lines.push(`  > ${bm.description}`);
          } else {
            lines.push(`- [${bm.title}](${bm.url})`);
          }
        }
        if (multiFolder) lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /* ── Start ── */
  init();

})();
