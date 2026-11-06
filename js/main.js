/* ============================================================
   ニック ポートフォリオ — main.js
   ・ナビ（ハンバーガー／現在地）・スクロールゲージ・出現演出
   ・詳細ダイアログ（目次・前後移動・←→キー・リンクコピー・ハッシュ履歴）
   ・画像の拡大表示・サイト内検索（Ctrl+K）・3分コース
   ・作品の絞り込み・既読の印・根拠リンクのプレビュー・スマホ下部ボタン
   ・動画ファサード・Before/After・メール／文面コピー・トースト
   分岐はテーブル駆動（switch 不使用）。ストレージは失敗しても動くように try/catch。
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const MOBILE = window.matchMedia('(max-width: 900px)');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* ---------- PDF 作成モード（URL に ?print） ----------
     画面外の画像も先に読み込み、縮小した JPEG に置き換えてから印刷する。
     そのままだと PDF に無圧縮で埋め込まれて数十MBになるため。
     すべて終わると <html data-print-ready="1"> になる（pdf.ps1 / 検証用） */
  if (/[?&]print\b/.test(location.search)) {
    const PRINT_MAX_W = 1100;
    const cache = new Map();   // 同じ画像は同じ JPEG を使い回す（PDF に二重に入れない）
    const imgs = $$('img').filter((img) => !/^data:|\.svg(\?|$)/i.test(img.getAttribute('src') || ''));
    let left = imgs.length;
    const done = () => { left -= 1; if (left <= 0) document.documentElement.dataset.printReady = '1'; };
    const toJpeg = (img) => {
      if (img.dataset.printed) return;
      img.dataset.printed = '1';
      try {
        const key = img.currentSrc || img.src;
        if (cache.has(key)) { img.src = cache.get(key); done(); return; }
        if (img.naturalWidth > 0) {
          const scale = Math.min(1, PRINT_MAX_W / img.naturalWidth);
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.78);
          cache.set(key, url);
          img.src = url;
        }
      } catch (e) { /* 変換できない環境では元の画像のまま印刷する */ }
      done();
    };
    $$('details.credits-box').forEach((d) => { d.open = true; });   // PDF では素材一覧を開いて載せる
    if (!imgs.length) document.documentElement.dataset.printReady = '1';
    imgs.forEach((img) => {
      img.loading = 'eager';
      if (img.complete) toJpeg(img);
      else {
        img.addEventListener('load', () => toJpeg(img), { once: true });
        img.addEventListener('error', () => { img.dataset.printed = '1'; done(); }, { once: true });
      }
    });
  }
  const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  const store = {
    get(area, key, fallback) { try { const v = window[area].getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(area, key, value) { try { window[area].setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても動作は続ける */ } }
  };

  /* ---------- トースト ---------- */
  const toastEl = $('#toast');
  let toastTimer = 0;
  const showToast = (message) => {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 2800);
  };

  /* ---------- コピー（失敗したら選択状態にする） ---------- */
  const selectText = (el) => {
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const copyText = (text, okMessage, fallbackEl, fallbackMessage) => {
    const fail = () => { selectText(fallbackEl); showToast(fallbackMessage); };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fail(); return; }
    navigator.clipboard.writeText(text).then(() => showToast(okMessage)).catch(fail);
  };

  /* ---------- ハンバーガーメニュー ---------- */
  const navToggle = $('.nav-toggle');
  const nav = $('#site-nav');
  const navLabel = $('.nav-toggle-label');
  const NAV_LABEL = { true: 'メニューを閉じる', false: 'メニューを開く' };
  const isNavOpen = () => !!navToggle && navToggle.getAttribute('aria-expanded') === 'true';
  const setNavOpen = (open) => {
    if (!navToggle || !nav) return;
    navToggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    if (navLabel) navLabel.textContent = NAV_LABEL[open];
  };
  if (navToggle) navToggle.addEventListener('click', () => setNavOpen(!isNavOpen()));
  if (nav) nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNavOpen(false); });
  document.addEventListener('click', (e) => { if (isNavOpen() && !e.target.closest('.site-header')) setNavOpen(false); });
  MOBILE.addEventListener('change', () => setNavOpen(false));

  /* ---------- 現在地・スクロールゲージ・読了の一言 ---------- */
  const navLinks = $$('#site-nav a[href^="#"]');
  const sections = navLinks
    .map((a) => ({ link: a, section: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter((item) => item.section);
  const gauge = $('.gauge');
  const header = $('.site-header');
  let thanked = store.get('sessionStorage', 'pf-thanked', false);

  const updateScroll = () => {
    if (document.body.classList.contains('is-locked')) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
    const atBottom = ratio > 0.995;
    if (gauge) {
      gauge.style.setProperty('--progress', ratio.toFixed(4));
      gauge.classList.toggle('is-max', atBottom);
    }
    if (atBottom && !thanked && max > window.innerHeight) {
      thanked = true;
      store.set('sessionStorage', 'pf-thanked', true);
      showToast('最後まで見ていただき、ありがとうございます');
    }
    const line = (header ? header.offsetHeight : 0) + window.innerHeight * 0.3;
    const passed = sections.filter((s) => s.section.getBoundingClientRect().top <= line);
    const current = atBottom ? sections[sections.length - 1] : passed[passed.length - 1];
    sections.forEach((s) => {
      if (s === current) s.link.setAttribute('aria-current', 'true');
      else s.link.removeAttribute('aria-current');
    });
  };
  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; updateScroll(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateScroll();

  /* ---------- 出現演出（初期表示で画面外の要素だけ） ---------- */
  if ('IntersectionObserver' in window && !REDUCED) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-waiting');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.classList.add('is-waiting');
      io.observe(el);
    });
  }

  /* ---------- 既読の印 ---------- */
  const visitedReset = $('.visited-reset');
  let visited = new Set(store.get('localStorage', 'pf-visited', []));
  const paintVisited = () => {
    $$('.work-card[data-key]').forEach((card) => card.classList.toggle('is-visited', visited.has(card.dataset.key)));
    if (visitedReset) visitedReset.hidden = visited.size === 0;
  };
  const markVisited = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    store.set('localStorage', 'pf-visited', Array.from(visited));
    paintVisited();
  };
  if (visitedReset) visitedReset.addEventListener('click', () => {
    visited = new Set();
    store.set('localStorage', 'pf-visited', []);
    paintVisited();
    showToast('既読の印を消しました');
  });
  paintVisited();

  /* ---------- 詳細ダイアログ ---------- */
  const modal = $('#modal');
  const modalBody = $('#modal-body');
  const modalLabel = $('#modal-label');
  const prevBtn = $('#modal-prev');
  const nextBtn = $('#modal-next');
  // 詳細本文の原本は HTML の <article class="detail">。並び順（作品→技術）がそのまま前後移動の順になる
  const details = new Map($$('.detail[data-key]').map((el) => [el.dataset.key, el]));
  const order = Array.from(details.keys());
  const titleOf = (key) => {
    const h3 = details.get(key) && details.get(key).querySelector('h3');
    return h3 && h3.firstChild ? h3.firstChild.textContent.trim() : '';
  };
  const state = { key: null, pushed: false, opener: null, lockY: 0 };

  const HISTORY_MODE = {
    push: (key) => { history.pushState({ modal: key }, '', '#' + key); state.pushed = true; },
    replace: (key) => { history.replaceState(history.state, '', '#' + key); },
    none: () => {}
  };

  // iOS でも背景の位置が保たれる方式のスクロールロック
  const lockScroll = () => {
    if (document.body.classList.contains('is-locked')) return;
    state.lockY = window.scrollY;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.top = -state.lockY + 'px';
    document.body.style.paddingRight = gap > 0 ? gap + 'px' : '';
    document.body.classList.add('is-locked');
  };
  const unlockScroll = () => {
    if (!document.body.classList.contains('is-locked')) return;
    document.body.classList.remove('is-locked');
    document.body.style.top = '';
    document.body.style.paddingRight = '';
    window.scrollTo({ top: state.lockY, behavior: 'instant' });
  };

  const setStepButton = (btn, key, arrowFirst) => {
    if (!btn) return;
    btn.hidden = !key;
    btn.dataset.target = key || '';
    if (!key) return;
    const title = titleOf(key);
    const span = document.createElement('span');
    span.textContent = title;
    btn.replaceChildren(arrowFirst ? '← ' : '', span, arrowFirst ? '' : ' →');
    btn.setAttribute('aria-label', (arrowFirst ? '前の詳細：' : '次の詳細：') + title);
  };

  // 目次：ダイアログ内でスクロール位置に合わせて現在地を付ける
  let tocObserver = null;
  const setupToc = () => {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    const links = $$('.toc a[data-toc]', modalBody);
    if (!links.length || !('IntersectionObserver' in window)) return;
    const byAnchor = new Map(links.map((a) => [a.dataset.toc, a]));
    const visibleSet = new Set();
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) visibleSet.add(en.target.dataset.anchor); else visibleSet.delete(en.target.dataset.anchor); });
      const heads = $$('h4[data-anchor]', modalBody);
      const first = heads.find((h) => visibleSet.has(h.dataset.anchor));
      if (!first) return;
      links.forEach((a) => a.removeAttribute('aria-current'));
      const link = byAnchor.get(first.dataset.anchor);
      if (link) {
        link.setAttribute('aria-current', 'true');
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }, { root: modalBody, rootMargin: '-56px 0px -55% 0px' });
    $$('h4[data-anchor]', modalBody).forEach((h) => tocObserver.observe(h));
  };

  const openDetail = (key, { mode = 'push', video = false } = {}) => {
    const source = details.get(key);
    if (!source || !modal || typeof modal.showModal !== 'function') return false;

    const clone = source.cloneNode(true);
    // 複製に id が残ると重複するので外す（目次は data-anchor で辿る）
    clone.removeAttribute('id');
    $$('[id]', clone).forEach((el) => el.removeAttribute('id'));
    const heading = clone.querySelector('h3');
    if (heading) heading.id = 'modal-title';
    modalBody.replaceChildren(clone);
    modalLabel.textContent = source.dataset.label || '';

    const index = order.indexOf(key);
    setStepButton(prevBtn, order[index - 1], true);
    setStepButton(nextBtn, order[index + 1], false);

    HISTORY_MODE[mode](key);
    state.key = key;
    markVisited(key);

    if (!modal.open) {
      lockScroll();
      modal.showModal();
    }
    modalBody.scrollTop = 0;
    setupToc();

    if (video) {
      const play = modalBody.querySelector('.video-play');
      if (play) { play.scrollIntoView({ block: 'center' }); play.focus({ preventScroll: true }); }
    }
    return true;
  };

  const closeDialog = () => {
    if (modal && modal.open) modal.close();
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    unlockScroll();
    state.key = null;
    state.pushed = false;
    const opener = state.opener;
    state.opener = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  const requestClose = () => {
    if (state.pushed) { history.back(); return; }
    closeDialog();
    history.replaceState(null, '', location.pathname + location.search);
  };

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open]');
    if (!trigger) return;
    const key = trigger.dataset.open;
    if (!details.has(key)) return;
    e.preventDefault();
    hidePeek();
    const insideModal = modal && modal.open;
    if (!insideModal) state.opener = trigger;
    openDetail(key, { mode: insideModal ? 'replace' : 'push', video: trigger.dataset.video === '1' });
  });

  if (modal) {
    modal.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) { requestClose(); return; }
      // 目次：ハッシュを変えずにダイアログ内だけスクロール
      const toc = e.target.closest('a[data-toc]');
      if (toc) {
        e.preventDefault();
        const target = modalBody.querySelector('[data-anchor="' + toc.dataset.toc + '"]');
        if (target) target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }
  [prevBtn, nextBtn].forEach((btn) => {
    if (btn) btn.addEventListener('click', () => { if (btn.dataset.target) openDetail(btn.dataset.target, { mode: 'replace' }); });
  });

  const copyLinkBtn = $('#copy-link');
  if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
    const url = location.href.split('#')[0] + '#' + (state.key || '');
    copyText(url, 'この詳細へのリンクをコピーしました', null, 'コピーできませんでした。アドレスバーのURLをお使いください');
  });

  window.addEventListener('popstate', () => {
    const key = location.hash.slice(1);
    if (details.has(key)) {
      state.pushed = Boolean(history.state && history.state.modal);
      openDetail(key, { mode: 'none' });
      return;
    }
    if (modal && modal.open) closeDialog();
  });

  /* ---------- 画像の拡大表示 ---------- */
  const lightbox = $('#lightbox');
  const lbImg = $('#lightbox-img');
  const lbCap = $('#lightbox-cap');
  const lbCount = $('#lightbox-count');
  const lb = { items: [], index: 0, opener: null };
  const showLightboxItem = (i) => {
    if (!lb.items.length) return;
    lb.index = (i + lb.items.length) % lb.items.length;
    const item = lb.items[lb.index];
    lbImg.src = item.src;
    lbImg.alt = item.alt;
    lbCap.textContent = item.caption;
    lbCount.textContent = (lb.index + 1) + ' / ' + lb.items.length;
  };
  const openLightbox = (button) => {
    if (!lightbox || typeof lightbox.showModal !== 'function') return;
    // ギャラリーの中なら同じギャラリーの画像を順に送る。単体の画像はその1枚だけ
    const group = button.closest('.gallery');
    const buttons = group ? $$('[data-zoom]', group) : [button];
    lb.items = buttons.map((b) => {
      const img = b.querySelector('img');
      const cap = b.closest('figure') && b.closest('figure').querySelector('figcaption');
      return { src: img.currentSrc || img.src, alt: img.alt, caption: cap ? cap.textContent : '' };
    });
    lb.opener = button;
    const single = lb.items.length < 2;
    $('#lightbox-prev').hidden = single;
    $('#lightbox-next').hidden = single;
    lbCount.hidden = single;
    showLightboxItem(buttons.indexOf(button));
    lightbox.showModal();
    lockScroll();
  };
  const closeLightbox = () => { if (lightbox && lightbox.open) lightbox.close(); };
  if (lightbox) {
    lightbox.addEventListener('close', () => {
      if (!(modal && modal.open)) unlockScroll();
      if (lb.opener && document.contains(lb.opener)) lb.opener.focus({ preventScroll: true });
    });
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.classList.contains('lightbox-figure')) closeLightbox(); });
    $('#lightbox-prev').addEventListener('click', () => showLightboxItem(lb.index - 1));
    $('#lightbox-next').addEventListener('click', () => showLightboxItem(lb.index + 1));
    $('#lightbox-close').addEventListener('click', closeLightbox);
  }
  document.addEventListener('click', (e) => {
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) openLightbox(zoom);
  });

  /* ---------- サイト内検索（Ctrl+K / "/"） ---------- */
  const search = $('#search');
  const searchInput = $('#search-input');
  const searchResults = $('#search-results');
  const searchIndex = [];
  details.forEach((el, key) => {
    const lead = el.querySelector('.detail-lead');
    const words = $$('h4, .tags li, .detail-grid dt, .detail-grid dd, p', el).map((n) => n.textContent).join(' ');
    searchIndex.push({ key, href: '#' + key, label: el.dataset.label || '', title: titleOf(key), text: lead ? lead.textContent : '', hay: (titleOf(key) + ' ' + (el.dataset.label || '') + ' ' + words).toLowerCase() });
  });
  sections.forEach((s) => {
    const lead = s.section.querySelector('.section-lead');
    searchIndex.push({ key: '', href: '#' + s.section.id, label: 'SECTION', title: s.link.textContent, text: lead ? lead.textContent : '', hay: (s.link.textContent + ' ' + s.section.textContent).toLowerCase() });
  });
  let searchSel = 0;
  const searchOpener = { el: null };
  const renderSearch = () => {
    const q = searchInput.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = terms.length ? searchIndex.filter((it) => terms.every((t) => it.hay.includes(t))).slice(0, 8) : searchIndex.slice(0, 8);
    searchSel = 0;
    searchResults.replaceChildren(...(hits.length ? hits.map((it, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = it.href;
      a.setAttribute('role', 'option');
      a.setAttribute('aria-selected', String(i === 0));
      if (it.key) a.dataset.searchOpen = it.key;
      const label = document.createElement('span'); label.className = 'search-result-label'; label.textContent = it.label;
      const title = document.createElement('span'); title.className = 'search-result-title'; title.textContent = it.title;
      const text = document.createElement('span'); text.className = 'search-result-text'; text.textContent = it.text;
      a.append(label, title, text);
      li.append(a);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'search-empty', textContent: '見つかりませんでした。別の言葉で試してください。' })]));
  };
  const moveSearch = (step) => {
    const links = $$('a', searchResults);
    if (!links.length) return;
    searchSel = (searchSel + step + links.length) % links.length;
    links.forEach((a, i) => a.setAttribute('aria-selected', String(i === searchSel)));
    links[searchSel].scrollIntoView({ block: 'nearest' });
  };
  const goSearchResult = (a) => {
    if (!a) return;
    search.close();
    if (a.dataset.searchOpen) { state.opener = searchOpener.el; openDetail(a.dataset.searchOpen, { mode: 'push' }); return; }
    const target = document.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  };
  const openSearch = () => {
    if (!search || typeof search.showModal !== 'function' || search.open) return;
    if (modal && modal.open) return;
    searchOpener.el = document.activeElement;
    searchInput.value = '';
    renderSearch();
    search.showModal();
    searchInput.focus();
  };
  if (search) {
    $$('.search-open').forEach((b) => b.addEventListener('click', openSearch));
    searchInput.addEventListener('input', renderSearch);
    $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); goSearchResult($$('a', searchResults)[searchSel]); });
    searchResults.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); goSearchResult(a); } });
    search.addEventListener('click', (e) => { if (e.target === search) search.close(); });
    search.addEventListener('close', () => { if (!(modal && modal.open) && searchOpener.el && document.contains(searchOpener.el)) searchOpener.el.focus({ preventScroll: true }); });
  }

  /* ---------- キーボード操作（状況ごとの対応表） ---------- */
  const KEYMAP = [
    // [条件, キー, 処理]
    [() => lightbox && lightbox.open, 'ArrowLeft', () => showLightboxItem(lb.index - 1)],
    [() => lightbox && lightbox.open, 'ArrowRight', () => showLightboxItem(lb.index + 1)],
    [() => search && search.open, 'ArrowDown', () => moveSearch(1)],
    [() => search && search.open, 'ArrowUp', () => moveSearch(-1)],
    [() => modal && modal.open && !(lightbox && lightbox.open), 'ArrowLeft', () => prevBtn && !prevBtn.hidden && prevBtn.click()],
    [() => modal && modal.open && !(lightbox && lightbox.open), 'ArrowRight', () => nextBtn && !nextBtn.hidden && nextBtn.click()],
    [() => isNavOpen(), 'Escape', () => { setNavOpen(false); navToggle.focus(); }],
    [() => !isTyping(document.activeElement) && !(modal && modal.open), '/', openSearch]
  ];
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    const inSearchInput = search && search.open && e.target === searchInput;
    if (isTyping(e.target) && !inSearchInput) return;
    if (e.target.classList && e.target.classList.contains('ba-range')) return;   // スライダーの←→を優先
    const hit = KEYMAP.find(([when, key]) => key === e.key && when());
    if (!hit) return;
    e.preventDefault();
    hit[2]();
  });

  /* ---------- 作品の絞り込み ---------- */
  const chips = $$('.chip[data-filter]');
  const filterStatus = $('.filter-status');
  const filterEmpty = $('.filter-empty');
  const applyFilter = (tag) => {
    let shown = 0;
    $$('.work-card[data-key]').forEach((card) => {
      const tags = (card.dataset.tags || '').split('|');
      const ok = !tag || tags.includes(tag);
      card.classList.toggle('is-filtered-out', !ok);
      if (ok) shown += 1;
    });
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === tag)));
    if (filterStatus) filterStatus.textContent = tag ? tag + '：' + shown + '作品' : '';
    if (filterEmpty) filterEmpty.hidden = shown > 0;
  };
  chips.forEach((c) => c.addEventListener('click', () => applyFilter(c.dataset.filter)));

  /* ---------- 根拠リンクのプレビュー（マウスとキーボード） ---------- */
  const peek = $('#peek');
  const canHover = window.matchMedia('(hover: hover)').matches;
  let peekLink = null;
  function hidePeek() { if (peek) peek.hidden = true; peekLink = null; }
  const showPeek = (link) => {
    peekLink = link;
    const src = details.get(link.dataset.open);
    if (!peek || !src) return;
    const img = src.querySelector('.detail-hero img');
    const lead = src.querySelector('.detail-lead');
    const body = document.createElement('div'); body.className = 'peek-body';
    const label = document.createElement('span'); label.className = 'peek-label'; label.textContent = src.dataset.label || '';
    const title = document.createElement('span'); title.className = 'peek-title'; title.textContent = titleOf(link.dataset.open);
    const text = document.createElement('span'); text.className = 'peek-text';
    const t = lead ? lead.textContent : '';
    text.textContent = t.length > 70 ? t.slice(0, 70) + '…' : t;
    body.append(label, title, text);
    const nodes = [];
    if (img) { const im = document.createElement('img'); im.src = img.getAttribute('src'); im.alt = ''; nodes.push(im); }
    nodes.push(body);
    peek.replaceChildren(...nodes);
    peek.hidden = false;
    const r = link.getBoundingClientRect();
    const w = peek.offsetWidth; const h = peek.offsetHeight;
    const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
    const above = r.top - h - 10;
    peek.style.left = left + 'px';
    peek.style.top = (above > 12 ? above : r.bottom + 10) + 'px';
  };
  $$('.evidence[data-open]').forEach((link) => {
    if (canHover) {
      link.addEventListener('mouseenter', () => showPeek(link));
      link.addEventListener('mouseleave', hidePeek);
    }
    link.addEventListener('focus', () => { if (link.matches(':focus-visible')) showPeek(link); });
    link.addEventListener('blur', hidePeek);
  });
  // キーボードで移動したときはページがスクロールするので、閉じずに位置だけ合わせ直す
  window.addEventListener('scroll', () => {
    if (!peekLink) return;
    if (peekLink === document.activeElement) showPeek(peekLink); else hidePeek();
  }, { passive: true });

  /* ---------- スマホ：ヒーローを過ぎたら下部ボタン ---------- */
  const mobileCta = $('.mobile-cta');
  const hero = $('#top');
  const tourEl = $('.tour');
  const setCta = (show) => {
    if (!mobileCta) return;
    const on = show && MOBILE.matches && !(tourEl && !tourEl.hidden);
    mobileCta.classList.toggle('is-shown', on);
    mobileCta.setAttribute('aria-hidden', String(!on));
    $$('a', mobileCta).forEach((a) => a.setAttribute('tabindex', on ? '0' : '-1'));
    document.body.classList.toggle('has-cta', on);
  };
  let heroVisible = true;
  if (mobileCta && hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { heroVisible = en.isIntersecting; setCta(!heroVisible); }).observe(hero);
    MOBILE.addEventListener('change', () => setCta(!heroVisible));
  }

  /* ---------- 3分コース ---------- */
  const tourSteps = $$('.tour-data li').map((li) => ({ target: li.dataset.target, title: li.dataset.title, text: li.textContent }));
  const tour = { i: 0 };
  const tourStepEl = $('.tour-step'); const tourTitle = $('.tour-title'); const tourText = $('.tour-text');
  const tourGo = $('.tour-go'); const tourPrev = $('.tour-prev'); const tourNext = $('.tour-next');
  const flash = (el) => {
    if (!el) return;
    el.classList.remove('is-tour-target');
    void el.offsetWidth;  // アニメーションを再開させる
    el.classList.add('is-tour-target');
  };
  // ステップの種類ごとの動き（セクションへ移動 or 詳細のカードへ移動して「開く」を出す）
  const TOUR_KIND = {
    section: (step) => {
      const el = document.querySelector(step.target);
      if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
      tourGo.hidden = true;
    },
    detail: (step) => {
      const card = document.querySelector('[data-key="' + step.target + '"]:not(.detail)');
      if (card) { card.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); flash(card); }
      tourGo.hidden = false;
      tourGo.dataset.open = step.target;
    }
  };
  const showTourStep = (i) => {
    tour.i = Math.max(0, Math.min(tourSteps.length - 1, i));
    const step = tourSteps[tour.i];
    tourStepEl.textContent = 'STEP ' + (tour.i + 1) + ' / ' + tourSteps.length;
    tourTitle.textContent = step.title;
    tourText.textContent = step.text;
    tourPrev.disabled = tour.i === 0;
    tourNext.textContent = tour.i === tourSteps.length - 1 ? '完了' : '次へ';
    TOUR_KIND[step.target.charAt(0) === '#' ? 'section' : 'detail'](step);
  };
  const endTour = () => { if (tourEl) tourEl.hidden = true; setCta(!heroVisible); };
  if (tourEl && tourSteps.length) {
    $$('.tour-start').forEach((b) => b.addEventListener('click', () => { tourEl.hidden = false; setCta(false); showTourStep(0); tourNext.focus(); }));
    tourPrev.addEventListener('click', () => showTourStep(tour.i - 1));
    tourNext.addEventListener('click', () => {
      if (tour.i === tourSteps.length - 1) { endTour(); showToast('3分コースはここまでです'); return; }
      showTourStep(tour.i + 1);
    });
    $('.tour-end').addEventListener('click', endTour);
  }

  // ハッシュで直接アクセスされたら自動で開く（履歴は積まない）
  const initialKey = location.hash.slice(1);
  if (details.has(initialKey)) openDetail(initialKey, { mode: 'none' });

  /* ---------- Before / After ---------- */
  document.addEventListener('input', (e) => {
    const range = e.target.closest('.ba-range');
    if (!range) return;
    const stage = range.closest('.ba-stage');
    if (stage) stage.style.setProperty('--pos', range.value + '%');
  });

  /* ---------- 動画ファサード ---------- */
  document.addEventListener('click', (e) => {
    const play = e.target.closest('.video-play');
    if (!play) return;
    const box = play.closest('[data-video-box]');
    const article = play.closest('.detail');
    const id = (article && article.dataset.youtube) || '';
    if (!id) { showToast('プレイ動画は準備中です'); return; }
    const frame = document.createElement('iframe');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0';
    frame.title = play.getAttribute('aria-label') || 'プレイ動画';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    box.replaceChildren(frame);
  });

  /* ---------- メールアドレス・文面のコピー ---------- */
  const copyMail = $('#copy-mail');
  const mailEl = $('#mail-addr');
  if (copyMail && mailEl) copyMail.addEventListener('click', () => {
    copyText(mailEl.textContent.trim(), 'メールアドレスをコピーしました', mailEl, 'アドレスを選択しました。Ctrl+C でコピーできます');
  });
  const copyTpl = $('#copy-template');
  const tplText = $('#mail-template-text');
  const tplSubject = $('.mail-template-subject');
  if (copyTpl && tplText) copyTpl.addEventListener('click', () => {
    const subject = tplSubject ? tplSubject.lastChild.textContent.trim() : '';
    copyText('件名：' + subject + '\n\n' + tplText.textContent, '件名と本文をコピーしました', tplText, '本文を選択しました。Ctrl+C でコピーできます');
  });
})();
