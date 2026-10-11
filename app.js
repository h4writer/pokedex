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

  // ---- State ----
  // collection: { [id]: { added: timestamp, cards: [{ number, set }] } }
  let collection = load();
  let filter = 'all';
  let gen = 0;
  let query = '';
  let current = null; // id shown in sheet

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); } catch { toast('Could not save!'); }
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
    $('#toggleOwned').focus();
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
      del.setAttribute('aria-label', 'Remove card');
      del.onclick = () => {
        entry.cards.splice(i, 1);
        commit(current);
      };
      li.append(label, del);
      return li;
    }));
  }

  function closeSheet() {
    sheet.hidden = true;
    backdrop.hidden = true;
    current = null;
  }

  function commit(id) {
    save();
    updateTile(id);
    updateProgress();
    applyFilter();
    if (current === id) renderSheet();
  }

  function addOwned(id) {
    if (!collection[id]) collection[id] = { added: Date.now(), cards: [] };
    commit(id);
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
      commit(id);
      toast(`${p.name} removed`, () => { collection[id] = removed; commit(id); });
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
    commit(current);
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

  const genSelect = $('#genSelect');
  const maxGen = Math.max(...POKEMON.map(p => p[2]));
  for (let g = 1; g <= maxGen; g++) genSelect.add(new Option(`Gen ${g}`, g));
  genSelect.addEventListener('change', () => {
    gen = Number(genSelect.value);
    applyFilter();
  });

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
      for (const [id, entry] of Object.entries(incoming)) {
        if (!byId.has(Number(id))) continue;
        const mine = collection[id] || (collection[id] = { added: entry.added || Date.now(), cards: [] });
        for (const c of entry.cards || []) {
          if (!c?.number) continue;
          if (!mine.cards.some(m => m.number === c.number && (m.set || '') === (c.set || ''))) mine.cards.push(c);
        }
      }
      save();
      for (const id of byId.keys()) updateTile(id);
      updateProgress();
      applyFilter();
      refreshSetList();
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

  // ---- Init ----
  buildGrid();
  for (const id of byId.keys()) updateTile(id);
  updateProgress();
  applyFilter();
  refreshSetList();
})();
