/**
 * bookmark-parser.js
 * Parses Netscape Bookmark File Format (exported by Chrome, Firefox, Edge, Safari).
 * Returns a normalized tree structure of folders and bookmarks.
 */
const BookmarkParser = (() => {

  /**
   * Parse one or many HTML bookmark file contents.
   * @param {string|string[]} htmlContents
   * @returns {{ tree: FolderNode, flat: Bookmark[], stats: object }}
   */
  function parse(htmlContents) {
    const contents = Array.isArray(htmlContents) ? htmlContents : [htmlContents];
    const rootChildren = [];

    for (const html of contents) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // The top-level <DL> directly under <BODY> or after <H1>
      const topDL = doc.querySelector('body > dl') || doc.querySelector('dl');
      if (topDL) {
        const parsed = parseDL(topDL, '');
        rootChildren.push(...parsed);
      }
    }

    // If multiple files, wrap in a single root
    const tree = {
      id: 'root',
      type: 'folder',
      title: 'Favoritos',
      children: rootChildren,
      path: '',
    };

    const flat = [];
    collectBookmarks(tree, flat);
    enrichBookmarks(flat);

    return {
      tree,
      flat,
      stats: buildStats(flat, tree),
    };
  }

  /* ── Internal parsers ── */

  function parseDL(dl, parentPath) {
    const items = [];
    const children = dl.children;

    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.tagName !== 'DT') continue;

      const h3 = el.querySelector(':scope > h3');
      const a  = el.querySelector(':scope > a');

      if (h3) {
        // Folder
        const title = h3.textContent.trim() || 'Sin nombre';
        const id = makeId(title + parentPath);
        const path = parentPath ? `${parentPath} / ${title}` : title;
        // Next sibling DL is the contents
        const nextDL = el.querySelector(':scope > dl') || findNextDL(el);
        const folderChildren = nextDL ? parseDL(nextDL, path) : [];
        items.push({
          id,
          type: 'folder',
          title,
          path,
          addDate: h3.getAttribute('add_date') ? new Date(h3.getAttribute('add_date') * 1000) : null,
          children: folderChildren,
        });
      } else if (a) {
        // Bookmark
        const title = a.textContent.trim() || a.getAttribute('href') || 'Sin título';
        const href  = a.getAttribute('href') || '';
        const icon  = a.getAttribute('icon') || '';
        items.push({
          id: makeId(href + title),
          type: 'bookmark',
          title,
          url: href,
          favicon: icon || faviconUrl(href),
          addDate: a.getAttribute('add_date') ? new Date(a.getAttribute('add_date') * 1000) : null,
          folder: parentPath,
          description: '',
          domain: extractDomain(href),
          baseDomain: extractBaseDomain(href),
        });
      }
    }
    return items;
  }

  function findNextDL(dtEl) {
    let sib = dtEl.nextElementSibling;
    while (sib) {
      if (sib.tagName === 'DL') return sib;
      if (sib.tagName === 'DT') break;
      sib = sib.nextElementSibling;
    }
    return null;
  }

  /* ── Enrichment ── */

  function enrichBookmarks(bookmarks) {
    // Group by base domain
    const domainMap = {};
    for (const bm of bookmarks) {
      if (!bm.baseDomain) continue;
      if (!domainMap[bm.baseDomain]) domainMap[bm.baseDomain] = [];
      domainMap[bm.baseDomain].push(bm);
    }
    // Attach similar bookmarks list (same domain)
    for (const bm of bookmarks) {
      bm.similarDomain = (domainMap[bm.baseDomain] || []).filter(b => b.id !== bm.id);
    }
  }

  function collectBookmarks(node, acc) {
    if (node.type === 'bookmark') { acc.push(node); return; }
    for (const child of (node.children || [])) collectBookmarks(child, acc);
  }

  /* ── Domain grouping ── */

  /**
   * Build a domain-grouped tree from flat bookmarks.
   * @param {Bookmark[]} bookmarks
   * @returns {FolderNode}
   */
  function buildDomainTree(bookmarks) {
    const map = {};
    for (const bm of bookmarks) {
      const key = bm.baseDomain || 'Sin dominio';
      if (!map[key]) map[key] = { id: makeId('d-' + key), type: 'folder', title: key, children: [], path: key, isDomainGroup: true };
      map[key].children.push(bm);
    }
    const children = Object.values(map).sort((a, b) => b.children.length - a.children.length);
    return { id: 'domain-root', type: 'folder', title: 'Por Dominio', children, path: '' };
  }

  /**
   * Build a topic-grouped tree using keyword clusters.
   * Topics are derived from folder names + common keywords.
   */
  function buildTopicTree(bookmarks) {
    const map = {};
    for (const bm of bookmarks) {
      // Use folder path first level as topic
      const topic = (bm.folder || '').split(' / ')[0] || 'General';
      if (!map[topic]) map[topic] = { id: makeId('t-' + topic), type: 'folder', title: topic, children: [], path: topic, isTopicGroup: true };
      map[topic].children.push(bm);
    }
    const children = Object.values(map).sort((a, b) => b.children.length - a.children.length);
    return { id: 'topic-root', type: 'folder', title: 'Por Tema', children, path: '' };
  }

  /* ── Stats ── */

  function buildStats(flat, tree) {
    const domains = new Set(flat.map(b => b.baseDomain).filter(Boolean));
    let folderCount = 0;
    const countFolders = node => { if (node.type === 'folder') { folderCount++; for (const c of node.children || []) countFolders(c); } };
    countFolders(tree);

    return {
      total: flat.length,
      domains: domains.size,
      folders: folderCount - 1, // exclude root
      withDescription: flat.filter(b => b.description).length,
    };
  }

  /* ── Utilities ── */

  function extractDomain(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function extractBaseDomain(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      // Keep last 2 parts (or 3 for .co.uk style)
      if (parts.length > 2 && parts[parts.length - 2].length <= 3) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    } catch { return ''; }
  }

  function faviconUrl(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}/favicon.ico`;
    } catch { return ''; }
  }

  let _idCounter = 0;
  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function makeId(seed) {
    // Counter suffix guarantees uniqueness even for identical seeds (duplicate bookmarks).
    return 'bm-' + hashStr(seed || String(_idCounter)) + '-' + (_idCounter++);
  }

  /* ── Markdown export ── */

  function toMarkdown(tree, flat, stats) {
    const lines = [];
    const now = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

    lines.push('# Favoritos del Navegador');
    lines.push('');
    lines.push(`> Exportado el ${now} · **${stats.total}** favoritos · **${stats.domains}** dominios · **${stats.folders}** carpetas`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Table of contents
    lines.push('## Tabla de Contenidos');
    lines.push('');
    appendTOC(tree, lines, 0);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Content
    appendFolderMD(tree, lines, 0);

    // Domain index
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Índice por Dominio');
    lines.push('');
    const domainMap = {};
    for (const bm of flat) {
      const d = bm.baseDomain || 'Otros';
      if (!domainMap[d]) domainMap[d] = [];
      domainMap[d].push(bm);
    }
    for (const [domain, bms] of Object.entries(domainMap).sort()) {
      lines.push(`### ${domain} (${bms.length})`);
      for (const bm of bms) {
        lines.push(`- [${bm.title}](${bm.url})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function appendTOC(node, lines, depth) {
    if (node.type === 'folder' && node.id !== 'root') {
      const indent = '  '.repeat(depth);
      const slug = slugify(node.title);
      const count = countLeaves(node);
      lines.push(`${indent}- [${node.title}](#${slug}) *(${count})*`);
    }
    for (const child of (node.children || [])) {
      if (child.type === 'folder') appendTOC(child, lines, depth + (node.id === 'root' ? 0 : 1));
    }
  }

  function appendFolderMD(node, lines, depth) {
    if (node.type === 'bookmark') {
      const desc = node.description ? `\n  > ${node.description}` : '';
      lines.push(`- **[${node.title}](${node.url})**${desc}`);
      return;
    }
    if (node.id !== 'root') {
      const hashes = '#'.repeat(Math.min(depth + 1, 6));
      lines.push('');
      lines.push(`${hashes} ${node.title}`);
      lines.push('');
    }
    const folders = (node.children || []).filter(c => c.type === 'folder');
    const bms     = (node.children || []).filter(c => c.type === 'bookmark');
    for (const bm of bms) appendFolderMD(bm, lines, depth + 1);
    for (const f  of folders) appendFolderMD(f, lines, depth + 1);
  }

  function countLeaves(node) {
    if (node.type === 'bookmark') return 1;
    return (node.children || []).reduce((s, c) => s + countLeaves(c), 0);
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  }

  return { parse, buildDomainTree, buildTopicTree, toMarkdown, collectBookmarks, countLeaves };
})();
