(() => {
  const STORAGE_KEY = 'pokedex.v1';
  const SPRITE = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
  const ARTWORK = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
  const TYPE_COLORS = {
    normal: '#a0a29f', fire: '#fba54c', water: '#539ddf', grass: '#5fbd58', electric: '#f2d94e',
    ice: '#75d0c1', fighting: '#d3425f', poison: '#b763cf', ground: '#da7c4d', flying: '#a1bbec',
    psychic: '#fa8581', bug: '#92bc2c', rock: '#c9bb8a', ghost: '#5f6dbc', dragon: '#0c69c8',
    dark: '#595761', steel: '#5695a3', fairy: '#ee90e6',
  };

  const $ = sel => document.querySelector(sel);
  const pad = n => '#' + String(n).padStart(4, '0');
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const byId = new Map(POKEMON.map(([id, name, gen, types]) => [id, { id, name, gen, types: types.map(t => TYPES[t]), key: norm(name) }]));

  const TOKEN_KEY = 'pokedex.token';
  const REPO_KEY = 'pokedex.repo';
  const DIRTY_KEY = 'pokedex.dirty';
  const DATA_PATH = 'collection.json';

  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  // ---- State ----
  // collection: { [id]: { added: timestamp, cards: [{ number, set }] } }
  // The shared copy lives in collection.json in the GitHub repo; localStorage is a cache.
  let collection = loadLocal();
  let token = lsGet(TOKEN_KEY);
  let repo = detectRepo();
  let filter = 'all';
  let gen = 0;
  let query = '';
  let current = null; // id shown in sheet

  function loadLocal() {
    try { return JSON.parse(lsGet(STORAGE_KEY)) || {}; } catch { return {}; }
  }

  // On <owner>.github.io/<repo>/ the repo is known from the URL. Elsewhere it can be set in the edit dialog.
  function detectRepo() {
    try {
      const saved = JSON.parse(lsGet(REPO_KEY));
      if (saved?.owner && saved?.name) return saved;
    } catch {}
    const host = location.hostname;
    if (!host.endsWith('.github.io')) return null;
    const owner = host.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner, name: seg && !seg.includes('.') ? seg : host };
  }

  const canEdit = () => !repo || !!token;

  function save(change) {
    lsSet(STORAGE_KEY, JSON.stringify(collection));
    if (repo && token) {
      lsSet(DIRTY_KEY, '1');
      if (change) pendingChanges.push(change);
      schedulePush();
    }
  }

  // ---- GitHub sync ----
  let remoteSha = null;
  let pendingChanges = [];
  let pushTimer = null;
  let pushing = false;
  let pushAgain = false;

  const contentsUrl = () => `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${DATA_PATH}`;
  function ghHeaders() {
    const h = { Accept: 'application/vnd.github+json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }
  const toBase64 = str => {
    let bin = '';
    for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  const fromBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  async function fetchRemote() {
    const res = await fetch(contentsUrl() + `?t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
    if (res.status === 404) return { data: {}, sha: null };
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const json = await res.json();
    return { data: JSON.parse(fromBase64(json.content) || '{}'), sha: json.sha };
  }

  function putRemote(message) {
    const body = { message, content: toBase64(JSON.stringify(collection, null, 1) + '\n') };
    if (remoteSha) body.sha = remoteSha;
    return fetch(contentsUrl(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  }

  function schedulePush() {
    setStatus('Saving…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1500);
  }

  async function push() {
    if (pushing) { pushAgain = true; return; }
    pushing = true;
    const changes = pendingChanges;
    pendingChanges = [];
    const message = changes.length ? changes.join(', ') : 'Update collection';
    try {
      let res = await putRemote(message);
      if (res.status === 409 || res.status === 422) {
        // File changed elsewhere (another device): get its current version and overwrite with ours.
        remoteSha = (await fetchRemote()).sha;
        res = await putRemote(message);
      }
      if (res.status === 401 || res.status === 403) throw new Error('auth');
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      remoteSha = (await res.json()).content.sha;
      if (!pushAgain) lsSet(DIRTY_KEY, null);
      setStatus('Saved ✓');
    } catch (e) {
      pendingChanges = changes.concat(pendingChanges);
      setStatus(e.message === 'auth' ? 'Token not accepted – check edit mode' : 'Not saved – tap to retry', true);
    }
    pushing = false;
    if (pushAgain) { pushAgain = false; push(); }
  }

  // Load the shared collection. Unsaved edits from this device are merged in and pushed.
  async function sync() {
    if (!repo) { setStatus(''); return; }
    setStatus(token ? 'Loading…' : '');
    try {
      const remote = await fetchRemote();
      remoteSha = remote.sha;
      if (token && lsGet(DIRTY_KEY)) {
        collection = mergeInto(remote.data, loadLocal());
        save('Sync from device');
      } else {
        collection = remote.data;
        // Visitors don't touch the local cache, so anything added here before edit mode is kept.
        if (token) lsSet(STORAGE_KEY, JSON.stringify(collection));
        setStatus(token ? 'Saved ✓' : `Viewing ${repo.owner}'s collection`);
      }
      refreshAll();
    } catch {
      setStatus('Could not load collection – tap to retry', true);
    }
  }

  // Add every Pokémon and card from `incoming` into `target` (nothing is removed).
  function mergeInto(target, incoming) {
    for (const [id, entry] of Object.entries(incoming || {})) {
      if (!byId.has(Number(id))) continue;
      const mine = target[id] || (target[id] = { added: entry.added || Date.now(), cards: [] });
      mine.cards ||= [];
      for (const c of entry.cards || []) {
        if (!c?.number) continue;
        if (!mine.cards.some(m => m.number === c.number && (m.set || '') === (c.set || ''))) mine.cards.push(c);
      }
    }
    return target;
  }

  let statusIsError = false;
  function setStatus(text, isError = false) {
    const el = $('#syncStatus');
    el.textContent = text;
    el.classList.toggle('error', isError);
    statusIsError = isError;
  }
  $('#syncStatus').addEventListener('click', () => {
    if (!statusIsError) return;
    pendingChanges.length ? push() : sync();
  });

  function applyMode() {
    document.body.classList.toggle('readonly', !canEdit());
    $('#editBtn').textContent = token ? 'Stop editing on this device' : 'Edit mode…';
    $('#editBtn').hidden = !repo && !token;
    $('#menuNote').textContent = !repo
      ? 'Saved in this browser only. Put the site on GitHub Pages to share it.'
      : token
        ? `Changes are saved to github.com/${repo.owner}/${repo.name} for everyone to see.`
        : 'Only someone with the edit token can change this collection.';
  }

  // ---- Grid ----
  const grid = $('#grid');
  const tiles = new Map();

  function buildGrid() {
    const frag = document.createDocumentFragment();
    for (const p of byId.values()) {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.dataset.id = p.id;
      tile.setAttribute('aria-label', `${p.name} ${pad(p.id)}`);
      tile.innerHTML = `<span class="tnum"></span><img loading="lazy" alt=""><span class="tname"></span><span class="tcards" hidden></span>`;
      tile.querySelector('.tnum').textContent = p.id;
      tile.querySelector('.tname').textContent = p.name;
      tile.querySelector('img').src = SPRITE(p.id);
      frag.appendChild(tile);
      tiles.set(p.id, tile);
    }
    grid.appendChild(frag);
    grid.addEventListener('click', e => {
      const tile = e.target.closest('.tile');
      if (tile) openSheet(Number(tile.dataset.id));
    });
  }

  function updateTile(id) {
    const tile = tiles.get(id);
    const entry = collection[id];
    tile.classList.toggle('owned', !!entry);
    const badge = tile.querySelector('.tcards');
    const n = entry?.cards?.length || 0;
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  function matches(p) {
    if (gen && p.gen !== gen) return false;
    const owned = !!collection[p.id];
    if (filter === 'owned' && !owned) return false;
    if (filter === 'missing' && owned) return false;
    if (!query) return true;
    if (/^#?\d+$/.test(query)) return String(p.id).startsWith(query.replace('#', '').replace(/^0+/, ''));
    return p.key.includes(norm(query));
  }

  function applyFilter() {
    let visible = 0;
    for (const p of byId.values()) {
      const show = matches(p);
      tiles.get(p.id).hidden = !show;
      if (show) visible++;
    }
    $('#empty').hidden = visible > 0;
  }

  function updateProgress() {
    const owned = Object.keys(collection).filter(id => byId.has(Number(id))).length;
    $('#ownedCount').textContent = owned;
    $('#totalCount').textContent = byId.size;
    $('#progressFill').style.width = (owned / byId.size * 100) + '%';
    updateRegions();
  }

  // Best match for the search box when pressing Enter.
  function topMatch() {
    if (!query) return null;
    if (/^#?\d+$/.test(query)) {
      const n = Number(query.replace('#', ''));
      if (byId.has(n)) return n;
    }
    const q = norm(query);
    if (!q) return null;
    let starts = null, contains = null;
    for (const p of byId.values()) {
      if (gen && p.gen !== gen) continue;
      if (p.key === q) return p.id;
      if (!starts && p.key.startsWith(q)) starts = p.id;
      if (!contains && p.key.includes(q)) contains = p.id;
    }
    return starts || contains;
  }

  // ---- Sheet ----
  const sheet = $('#sheet');
  const backdrop = $('#backdrop');

  function openSheet(id) {
    current = id;
    const p = byId.get(id);
    const hero = $('#sheetHero');
    const [c1, c2] = p.types.map(t => TYPE_COLORS[t]);
    hero.style.background = `linear-gradient(135deg, ${c1}, ${c2 || c1})`;
    $('#sheetImg').src = ARTWORK(id);
    $('#sheetImg').alt = p.name;
    $('#sheetNum').textContent = pad(id);
    $('#sheetName').textContent = p.name;
    const types = $('#sheetTypes');
    types.replaceChildren(...p.types.map(t => {
      const s = document.createElement('span');
      s.className = 'type';
      s.textContent = t;
      s.style.background = TYPE_COLORS[t];
      return s;
    }));
    $('#cardNumber').value = '';
    $('#cardSet').value = '';
    renderSheet();
    sheet.hidden = false;
    backdrop.hidden = false;
    if (canEdit()) $('#toggleOwned').focus();
  }

  function renderSheet() {
    const entry = collection[current];
    $('#sheetHero').classList.toggle('missing', !entry);
    const btn = $('#toggleOwned');
    btn.textContent = entry ? 'Remove from collection' : 'I have it!';
    btn.classList.toggle('remove', !!entry);

    const list = $('#cardList');
    list.replaceChildren(...(entry?.cards || []).map((c, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const num = document.createElement('strong');
      num.textContent = c.number;
      label.appendChild(num);
      if (c.set) {
        const set = document.createElement('span');
        set.className = 'set';
        set.textContent = c.set;
        label.appendChild(set);
      }
      const del = document.createElement('button');
      del.textContent = '✕';
      del.className = 'edit-only';
      del.setAttribute('aria-label', 'Remove card');
      del.onclick = () => {
        entry.cards.splice(i, 1);
        commit(current, `Remove card ${c.number} from ${byId.get(current).name}`);
      };
      li.append(label, del);
      return li;
    }));
    $('#cardsSection').classList.toggle('no-cards', !entry?.cards?.length);
  }

  function closeSheet() {
    sheet.hidden = true;
    backdrop.hidden = true;
    current = null;
  }

  function commit(id, change) {
    save(change);
    updateTile(id);
    updateProgress();
    applyFilter();
    if (current === id) renderSheet();
  }

  function addOwned(id) {
    if (!collection[id]) collection[id] = { added: Date.now(), cards: [] };
    commit(id, `Add ${byId.get(id).name}`);
    const tile = tiles.get(id);
    tile.classList.remove('pop');
    void tile.offsetWidth;
    tile.classList.add('pop');
  }

  // After adding from a search, get ready for the next one.
  function resetSearchForNext() {
    const search = $('#search');
    if (search.value) {
      search.value = '';
      query = '';
      applyFilter();
    }
    search.focus();
  }

  $('#toggleOwned').addEventListener('click', () => {
    const id = current;
    const p = byId.get(id);
    if (collection[id]) {
      const removed = collection[id];
      delete collection[id];
      commit(id, `Remove ${p.name}`);
      toast(`${p.name} removed`, () => { collection[id] = removed; commit(id, `Add ${p.name}`); });
    } else {
      addOwned(id);
      closeSheet();
      toast(`${p.name} added! 🎉`);
      resetSearchForNext();
    }
  });

  $('#cardForm').addEventListener('submit', e => {
    e.preventDefault();
    const number = $('#cardNumber').value.trim();
    const set = $('#cardSet').value.trim();
    if (!number) { $('#cardNumber').focus(); return; }
    if (!collection[current]) addOwned(current);
    collection[current].cards.push(set ? { number, set } : { number });
    commit(current, `Add card ${number}${set ? ' (' + set + ')' : ''} to ${byId.get(current).name}`);
    refreshSetList();
    $('#cardNumber').value = '';
    $('#cardNumber').focus();
  });

  function refreshSetList() {
    const sets = new Set();
    for (const e of Object.values(collection)) for (const c of e.cards || []) if (c.set) sets.add(c.set);
    $('#setList').replaceChildren(...[...sets].sort().map(s => {
      const o = document.createElement('option');
      o.value = s;
      return o;
    }));
  }

  $('#sheetClose').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!sheet.hidden) closeSheet();
      if (!$('#editSheet').hidden) { $('#editSheet').hidden = true; backdrop.hidden = true; }
      $('#menu').hidden = true;
    }
  });

  // ---- Search & filters ----
  const search = $('#search');
  search.addEventListener('input', () => {
    query = search.value.trim();
    applyFilter();
  });
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const id = topMatch();
    if (id) {
      e.preventDefault();
      search.blur();
      openSheet(id);
    }
  });

  document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    filter = chip.dataset.filter;
    applyFilter();
  }));

  // ---- Generations (Pokémon GO-style region cards) ----
  const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  const regionCards = new Map(); // gen (0 = all) -> card element
  function buildRegions() {
    const nav = $('#regions');
    const maxGen = Math.max(...POKEMON.map(p => p[2]));
    for (let g = 0; g <= maxGen; g++) {
      const card = document.createElement('button');
      card.className = 'region' + (g === 0 ? ' active' : '');
      card.innerHTML = `<span class="rgen"></span><span class="rname"></span><span class="rcount"></span><span class="rbar"><span></span></span>`;
      card.querySelector('.rgen').textContent = g ? `Gen ${g}` : 'Everything';
      card.querySelector('.rname').textContent = g ? (REGIONS[g - 1] || `Gen ${g}`) : 'All';
      card.addEventListener('click', () => {
        gen = g;
        for (const c of regionCards.values()) c.classList.toggle('active', c === card);
        applyFilter();
      });
      nav.appendChild(card);
      regionCards.set(g, card);
    }
  }
  function updateRegions() {
    const total = new Map(), owned = new Map();
    for (const p of byId.values()) {
      for (const g of [0, p.gen]) {
        total.set(g, (total.get(g) || 0) + 1);
        if (collection[p.id]) owned.set(g, (owned.get(g) || 0) + 1);
      }
    }
    for (const [g, card] of regionCards) {
      const t = total.get(g) || 0, o = owned.get(g) || 0;
      card.querySelector('.rcount').textContent = `${o} / ${t}`;
      card.querySelector('.rbar span').style.width = (t ? o / t * 100 : 0) + '%';
      card.classList.toggle('complete', t > 0 && o === t);
    }
  }

  $('#fab').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    search.focus();
    search.select();
  });

  // ---- Menu: export / import ----
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  $('#exportBtn').addEventListener('click', () => {
    const data = JSON.stringify({ version: 1, exported: new Date().toISOString(), collection }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `pokedex-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    menu.hidden = true;
  });

  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.collection || data;
      if (typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('bad file');
      // Merge: keep everything already here, add new Pokémon and cards from the backup.
      mergeInto(collection, incoming);
      save('Import backup');
      refreshAll();
      toast('Backup imported');
    } catch {
      toast('That file is not a valid backup');
    }
    menu.hidden = true;
  });

  // ---- Toast ----
  let toastTimer;
  function toast(msg, undo) {
    const el = $('#toast');
    el.replaceChildren(document.createTextNode(msg));
    if (undo) {
      const b = document.createElement('button');
      b.textContent = 'Undo';
      b.style.cssText = 'margin-left:12px;background:none;border:none;color:#7fe0cf;font-weight:700';
      b.onclick = () => { undo(); el.hidden = true; };
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 4000 : 1800);
  }

  // ---- Edit mode (GitHub token) ----
  const editSheet = $('#editSheet');
  function closeEdit() {
    editSheet.hidden = true;
    backdrop.hidden = sheet.hidden;
  }
  $('#editBtn').addEventListener('click', () => {
    menu.hidden = true;
    if (token) {
      token = null;
      lsSet(TOKEN_KEY, null);
      applyMode();
      sync();
      toast('Edit mode off on this device');
      return;
    }
    $('#editOwner').value = repo?.owner || '';
    $('#editRepo').value = repo?.name || '';
    $('#editToken').value = '';
    $('#editError').hidden = true;
    editSheet.hidden = false;
    backdrop.hidden = false;
    $('#editToken').focus();
  });
  $('#editClose').addEventListener('click', closeEdit);
  backdrop.addEventListener('click', closeEdit);

  $('#editForm').addEventListener('submit', async e => {
    e.preventDefault();
    const owner = $('#editOwner').value.trim();
    const name = $('#editRepo').value.trim();
    const newToken = $('#editToken').value.trim();
    const err = $('#editError');
    const btn = $('#editSubmit');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${newToken}` },
      });
      if (res.status === 401) throw new Error('GitHub did not accept this token.');
      if (res.status === 404) throw new Error(`Repository ${owner}/${name} not found (or the token has no access to it).`);
      if (!res.ok) throw new Error(`GitHub error ${res.status}.`);
      if (!(await res.json()).permissions?.push) throw new Error('This token can only read the repository. Give it "Contents: Read and write".');
      token = newToken;
      repo = { owner, name };
      lsSet(TOKEN_KEY, token);
      lsSet(REPO_KEY, JSON.stringify(repo));
      // Anything added on this device before edit mode gets merged into the shared collection.
      if (Object.keys(loadLocal()).length) lsSet(DIRTY_KEY, '1');
      closeEdit();
      applyMode();
      await sync();
      toast('Edit mode on – changes are saved for everyone');
    } catch (ex) {
      err.textContent = ex.message === 'Failed to fetch' ? 'Could not reach GitHub.' : ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
    btn.textContent = 'Start editing';
  });

  function refreshAll() {
    for (const id of byId.keys()) updateTile(id);
    updateProgress();
    applyFilter();
    refreshSetList();
    if (current) renderSheet();
  }

  // ---- Init ----
  buildGrid();
  buildRegions();
  applyMode();
  refreshAll();
  sync();
})();
