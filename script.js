/* ═══════════════════════════════════════════════════════════════
   EduBooks — script.js (v2)

   SETUP:
   1. GAS_URL  → paste your deployed Google Apps Script Web App URL
   2. UPI_ID   → paste your UPI payment ID  (e.g. yourname@upi)
═══════════════════════════════════════════════════════════════ */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyCoigDwTyCnkqURmOphzQ9BYUKYwIalWDkDHodx_TqLGXi1VeEpis5Xa_qD8tVFIQO/exec';
const UPI_ID  = 'ganeshkumardwivedi90@oksbi';

/* ── STATE ─────────────────────────────────────────────────────── */
let currentUser   = null;
let adminCreds    = null;
let allBooks      = [];
let filteredBooks = [];
let purchases     = [];       // bookIds the current user owns
let cart          = [];       // array of book objects
let currentCategory = 'all';
let currentSort     = 'newest';
let searchQuery     = '';

// Checkout state
let checkoutCart        = [];
let checkoutFinalTotal  = 0;
let checkoutDiscount    = 0;
let checkoutCouponCode  = '';
let checkoutScreenshot  = null;

/* ── INIT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('eb_theme') || 'light');

  if (!GAS_URL || GAS_URL === 'YOUR_GAS_SCRIPT_URL_HERE') {
    el('setup-banner')?.classList.remove('hidden');
  }

  try {
    const sc = localStorage.getItem('eb_cart');
    if (sc) cart = JSON.parse(sc);
  } catch { cart = []; }

  updateCartBadge();
  restoreSession();
  loadBooks();

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    const drop = el('user-dropdown');
    const trig = el('avatar-trigger');
    if (drop && !drop.classList.contains('hidden') &&
        trig && !trig.contains(e.target) && !drop.contains(e.target)) {
      drop.classList.add('hidden');
    }
  });
});

/* ── GAS HELPER ───────────────────────────────────────────────── */
async function gas(action, body = {}) {
  if (!GAS_URL || GAS_URL === 'YOUR_GAS_SCRIPT_URL_HERE')
    throw new Error('GAS_URL not set. Open script.js and paste your deployed Apps Script URL.');
  const payload = JSON.stringify({ action, ...body });
  let res, text;
  try {
    res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ payload })
    });
    text = await res.text();
  } catch (err) {
    throw new Error('Network error — check your internet connection.');
  }
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error('Server error. Re-deploy GAS as Web App (Execute as: Me, Anyone).');
  }
  if (json.success === false || json.error) throw new Error(json.error || 'Request failed.');
  return json;
}

/* ── THEME ────────────────────────────────────────────────────── */
function toggleTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(t);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('eb_theme', t);
  el('icon-moon')?.classList.toggle('hidden', t === 'dark');
  el('icon-sun')?.classList.toggle('hidden',  t !== 'dark');
}

/* ── SESSION ─────────────────────────────────────────────────── */
function restoreSession() {
  try {
    const raw = localStorage.getItem('eb_session');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s?.user?.email && s?.user?.role) setCurrentUser(s.user, s.adminCreds || null);
    else localStorage.removeItem('eb_session');
  } catch { localStorage.removeItem('eb_session'); }
}

function setCurrentUser(user, creds) {
  if (!user?.email) return;
  currentUser = user;
  adminCreds  = creds || null;
  const isAdmin  = user.role === 'admin';
  const initials = getInitials(user.name || user.username || 'U');

  toggle('nav-logged-out', false);
  toggle('nav-logged-in',  true);
  toggle('mob-auth-out',   false);
  toggle('mob-signout',    true);
  toggle('mob-lib',        !isAdmin);
  toggle('mob-admin',      isAdmin);
  toggle('admin-link',     isAdmin);

  el('user-initials').textContent = initials;
  el('drop-initials').textContent = initials;
  setText('drop-name',  user.name || user.username);
  setText('drop-email', user.email);
  const rb = el('drop-role');
  if (rb) { rb.textContent = isAdmin ? 'Admin' : 'Buyer'; rb.className = 'badge-role' + (isAdmin ? ' admin' : ''); }

  setText('dash-avatar',    initials);
  setText('dash-name',      user.name || user.username);
  setText('dash-email',     user.email);
  setText('profile-avatar', initials);
  setText('profile-name',   user.name || user.username);
  setText('profile-email',  user.email);
  setText('profile-username', '@' + (user.username || ''));
  const prb = el('profile-role');
  if (prb) { prb.textContent = user.role || 'buyer'; prb.className = 'badge-role' + (isAdmin ? ' admin' : ''); }
}

async function signOut() {
  currentUser = null; adminCreds = null; purchases = [];
  localStorage.removeItem('eb_session');
  toggle('nav-logged-in',  false);
  toggle('nav-logged-out', true);
  toggle('mob-auth-out',   true);
  toggle('mob-signout',    false);
  toggle('mob-lib',        false);
  toggle('mob-admin',      false);
  toggle('admin-link',     false);
  closeMobileMenu();
  showPage('home');
  renderBooks();
  showToast('Signed out successfully.', 'info');
}

/* ── PAGES ───────────────────────────────────────────────────── */
function showPage(page) {
  if (page === 'dashboard' && !currentUser) { openAuth('login'); return; }
  if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Admin access only.', 'error'); return;
  }
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active'); p.classList.add('hidden');
  });
  const target = el('page-' + page);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (page === 'dashboard') loadDashboard();
  if (page === 'admin')     loadAdmin();
}

/* ── MOBILE MENU ─────────────────────────────────────────────── */
function toggleMobileMenu() {
  const drawer = el('mobile-drawer');
  const ham    = el('hamburger');
  const isOpen = !drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', isOpen);
  ham?.classList.toggle('open', !isOpen);
}
function closeMobileMenu() {
  el('mobile-drawer')?.classList.add('hidden');
  el('hamburger')?.classList.remove('open');
}

/* ── USER MENU ───────────────────────────────────────────────── */
function toggleUserMenu() {
  el('user-dropdown')?.classList.toggle('hidden');
}
function closeUserMenu() {
  el('user-dropdown')?.classList.add('hidden');
}

/* ── AUTH ─────────────────────────────────────────────────────── */
function openAuth(tab) {
  el('auth-modal').classList.remove('hidden');
  switchAuthTab(tab || 'login');
}
function switchAuthTab(tab) {
  ['login', 'register', 'admin'].forEach(t => {
    el('tab-'  + t)?.classList.toggle('active', t === tab);
    el('form-' + t)?.classList.toggle('hidden', t !== tab);
  });
}

async function submitRegister() {
  const btn  = el('register-btn');
  const name     = val('reg-name');
  const username = val('reg-username');
  const email    = val('reg-email');
  const password = val('reg-password');
  if (!name || !username || !email || !password) { showToast('Please fill in all fields.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  setBtnLoading(btn, true, 'Creating…');
  try {
    const res  = await gas('registerBuyer', { name, username, email, password });
    const user = res.user;
    if (!user?.email) { showToast('Registration failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    closeModal('auth-modal');
    clearInputs(['reg-name', 'reg-username', 'reg-email', 'reg-password']);
    purchases = [];
    renderBooks();
    showToast('Welcome, ' + (user.name || user.username) + '!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  setBtnLoading(btn, false, 'Create Account');
}

async function submitLogin() {
  const btn      = el('login-btn');
  const username = val('login-username');
  const password = val('login-password');
  if (!username || !password) { showToast('Enter your username and password.', 'error'); return; }
  setBtnLoading(btn, true, 'Signing in…');
  try {
    const res  = await gas('loginBuyer', { username, password });
    const user = res.user;
    if (!user?.email) { showToast('Login failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    closeModal('auth-modal');
    clearInputs(['login-username', 'login-password']);
    purchases = await loadPurchases();
    renderBooks();
    showToast('Welcome back, ' + (user.name || user.username) + '!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  setBtnLoading(btn, false, 'Sign In');
}

async function submitAdminLogin() {
  const btn      = el('admin-login-btn');
  const username = val('admin-username');
  const password = val('admin-password');
  if (!username || !password) { showToast('Enter admin credentials.', 'error'); return; }
  setBtnLoading(btn, true, 'Checking…');
  try {
    const res  = await gas('checkAdmin', { username, password });
    const user = res.user;
    if (!user?.email) { showToast('Admin login failed.', 'error'); return; }
    const creds = { adminUsername: username, adminPassword: password };
    localStorage.setItem('eb_session', JSON.stringify({ user, adminCreds: creds }));
    setCurrentUser(user, creds);
    closeModal('auth-modal');
    clearInputs(['admin-username', 'admin-password']);
    showToast('Admin access granted.', 'success');
    showPage('admin');
  } catch (err) { showToast(err.message, 'error'); }
  setBtnLoading(btn, false, 'Admin Login');
}

function togglePw(inputId, btn) {
  const input = el(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type     = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Hide' : 'Show';
}

/* ── BOOKS ───────────────────────────────────────────────────── */
async function loadBooks() {
  try {
    const res = await gas('getBooks');
    allBooks = res.books || [];
    if (currentUser && currentUser.role !== 'admin') {
      purchases = await loadPurchases();
    }
    applyFiltersAndSort();
  } catch (err) {
    el('books-loading')?.classList.add('hidden');
    showToast('Failed to load books: ' + err.message, 'error');
  }
}

async function loadPurchases() {
  if (!currentUser?.email) return [];
  try {
    const res = await gas('getPurchases', { email: currentUser.email });
    return (res.purchases || []).map(p => p.bookId);
  } catch { return []; }
}

function handleSearch(e) {
  searchQuery = (e.target.value || '').trim().toLowerCase();
  // sync both search inputs
  const heroInput = el('hero-search-input');
  const navInput  = el('nav-search-input');
  if (e.target !== heroInput && heroInput) heroInput.value = e.target.value;
  if (e.target !== navInput  && navInput)  navInput.value  = e.target.value;
  applyFiltersAndSort();
}

function setCategory(cat, btn) {
  currentCategory = cat;
  document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
  btn?.classList.add('active');
  applyFiltersAndSort();
}

function handleSort(val) {
  currentSort = val;
  applyFiltersAndSort();
}

function applyFiltersAndSort() {
  let books = [...allBooks];

  // Category filter
  if (currentCategory !== 'all') {
    books = books.filter(b => (b.category || 'Other') === currentCategory);
  }

  // Search filter
  if (searchQuery) {
    books = books.filter(b => {
      const title    = (b.title       || '').toLowerCase();
      const desc     = (b.description || '').toLowerCase();
      const keywords = (b.keywords    || '').toLowerCase();
      const category = (b.category    || '').toLowerCase();
      return title.includes(searchQuery) || desc.includes(searchQuery) ||
             keywords.includes(searchQuery) || category.includes(searchQuery);
    });
  }

  // Sort
  switch (currentSort) {
    case 'popular':
      books.sort((a, b) => (parseFloat(b.salesCount) || 0) - (parseFloat(a.salesCount) || 0));
      break;
    case 'rating':
      books.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
      break;
    case 'price-asc':
      books.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0));
      break;
    case 'price-desc':
      books.sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
      break;
    case 'newest':
    default:
      books.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
      break;
  }

  filteredBooks = books;
  renderBooks();
}

function renderBooks() {
  const loading = el('books-loading');
  const grid    = el('books-grid');
  const empty   = el('books-empty');
  if (!grid) return;

  loading?.classList.add('hidden');
  grid.classList.remove('hidden');

  if (!filteredBooks.length) {
    grid.innerHTML = '';
    grid.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  grid.innerHTML = filteredBooks.map(book => bookCard(book)).join('');
}

function bookCard(book) {
  const owned   = purchases.includes(book.id);
  const inCart  = cart.some(c => c.id === book.id);
  const price   = parseFloat(book.price) || 0;
  const rating  = parseFloat(book.rating) || 0;
  const stars   = renderStars(rating);
  const count   = parseInt(book.ratingsCount) || 0;

  const thumb = book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy" onerror="this.src='';this.style.display='none';this.parentElement.classList.add('no-thumb')" />`
    : `<div class="book-placeholder"><svg viewBox="0 0 48 64" fill="none"><rect x="2" y="2" width="44" height="60" rx="4" fill="var(--border)"/><path d="M12 24h24M12 32h24M12 40h16" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round"/></svg></div>`;

  const catBadge = book.category ? `<span class="cat-badge">${esc(book.category)}</span>` : '';

  return `
    <div class="book-card" onclick="openBookDetail('${book.id}')">
      <div class="book-thumb">${thumb}${catBadge}</div>
      <div class="book-body">
        <h3 class="book-title">${esc(book.title)}</h3>
        <div class="book-meta">
          <div class="book-rating">
            ${stars}
            <span class="rating-val">${rating > 0 ? rating.toFixed(1) : 'New'}</span>
            ${count > 0 ? `<span class="rating-count">(${count})</span>` : ''}
          </div>
          ${parseInt(book.salesCount) > 0 ? `<span class="sales-count">${book.salesCount} sold</span>` : ''}
        </div>
        <div class="book-price-row">
          <span class="book-price">₹${price.toFixed(0)}</span>
          ${owned ? '<span class="owned-badge">Owned</span>' : ''}
        </div>
        ${owned ? `
          <div class="book-actions">
            <button class="btn btn-ghost btn-sm w-full" onclick="event.stopPropagation();openReader('${book.id}')">Read Now</button>
          </div>
        ` : `
          <div class="book-actions">
            <button class="btn btn-ghost btn-sm flex-1" onclick="event.stopPropagation();addToCart('${book.id}')" ${inCart ? 'disabled' : ''}>
              ${inCart ? 'In Cart' : 'Add to Cart'}
            </button>
            <button class="btn btn-primary btn-sm flex-1" onclick="event.stopPropagation();buyNow('${book.id}')">Buy Now</button>
          </div>
        `}
      </div>
    </div>`;
}

function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= full) html += '<span class="star full">★</span>';
    else if (i === full + 1 && half) html += '<span class="star half">★</span>';
    else html += '<span class="star empty">★</span>';
  }
  return html;
}

/* ── BOOK DETAIL ─────────────────────────────────────────────── */
function openBookDetail(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  const owned   = purchases.includes(book.id);
  const inCart  = cart.some(c => c.id === book.id);
  const price   = parseFloat(book.price) || 0;
  const rating  = parseFloat(book.rating) || 0;

  const thumb = book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" />`
    : `<div class="detail-placeholder"><svg viewBox="0 0 64 88" fill="none"><rect x="2" y="2" width="60" height="84" rx="6" fill="var(--bg3)"/><path d="M18 36h28M18 48h28M18 60h20" stroke="var(--border)" stroke-width="2.5" stroke-linecap="round"/></svg></div>`;

  el('book-detail-content').innerHTML = `
    <div class="book-detail">
      <div class="detail-cover">${thumb}</div>
      <div class="detail-info">
        ${book.category ? `<span class="cat-badge mb-sm">${esc(book.category)}</span>` : ''}
        <h1 class="detail-title">${esc(book.title)}</h1>
        <div class="detail-rating">
          <div class="book-rating large">${renderStars(rating)}</div>
          <span class="rating-val">${rating > 0 ? rating.toFixed(1) : 'No ratings yet'}</span>
          ${parseInt(book.ratingsCount) > 0 ? `<span class="text-muted fs-sm">(${book.ratingsCount} ratings)</span>` : ''}
          ${parseInt(book.salesCount) > 0 ? `<span class="text-muted fs-sm"> · ${book.salesCount} sold</span>` : ''}
        </div>
        ${book.description ? `<p class="detail-desc">${esc(book.description)}</p>` : ''}
        ${book.keywords ? `<div class="detail-keywords">${book.keywords.split(',').map(k => `<span class="keyword-tag">${esc(k.trim())}</span>`).join('')}</div>` : ''}
        <div class="detail-price-row">
          <span class="detail-price">₹${price.toFixed(0)}</span>
          ${owned ? '<span class="owned-badge">Owned</span>' : ''}
        </div>
        ${owned ? `
          <div class="detail-actions">
            <button class="btn btn-primary flex-1" onclick="openReader('${book.id}')">Read Now</button>
            ${purchases.includes(book.id) ? `<button class="btn btn-ghost flex-1" onclick="openRateModal('${book.id}')">Rate this book</button>` : ''}
          </div>
        ` : `
          <div class="detail-actions">
            <button class="btn btn-ghost flex-1" onclick="addToCart('${book.id}')" id="detail-cart-btn" ${inCart ? 'disabled' : ''}>
              ${inCart ? 'In Cart' : 'Add to Cart'}
            </button>
            <button class="btn btn-primary flex-1" onclick="buyNow('${book.id}')">Buy Now</button>
          </div>
        `}
        ${book.pdf && !owned ? `
          <button class="btn btn-ghost w-full mt-sm" onclick="openPreviewReader('${book.id}')">
            <svg viewBox="0 0 20 20" fill="none" style="width:16px;height:16px"><path d="M1 10S4 4 10 4s9 6 9 6-3 6-9 6-9-6-9-6z" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.4"/></svg>
            Preview (First Pages)
          </button>
        ` : ''}
      </div>
    </div>`;

  showPage('book');
}

/* ── READER ──────────────────────────────────────────────────── */
function openReader(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book || !book.pdf) { showToast('PDF not available.', 'error'); return; }
  if (!purchases.includes(bookId) && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Purchase this book to read it.', 'error'); return;
  }
  el('preview-title').textContent  = book.title;
  el('preview-iframe').src         = book.pdf;
  el('preview-modal').classList.remove('hidden');
  document.body.style.overflow     = 'hidden';
}

function openPreviewReader(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book || !book.pdf) return;
  // Append page range for preview (first 5 pages)
  const previewUrl = book.pdf.includes('?') ? book.pdf + '#page=1' : book.pdf + '#page=1';
  el('preview-title').textContent = book.title + ' — Preview';
  el('preview-iframe').src        = previewUrl;
  el('preview-modal').classList.remove('hidden');
  document.body.style.overflow    = 'hidden';
}

/* ── CART ─────────────────────────────────────────────────────── */
function addToCart(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  if (purchases.includes(bookId)) { showToast('You already own this book.', 'info'); return; }
  if (cart.some(c => c.id === bookId)) { showToast('Already in cart.', 'info'); return; }
  cart.push(book);
  saveCart();
  updateCartBadge();
  renderCartSidebar();
  showToast(`"${book.title}" added to cart.`, 'success');
  renderBooks();
  // Update detail page if open
  const dcb = el('detail-cart-btn');
  if (dcb) { dcb.disabled = true; dcb.textContent = 'In Cart'; }
}

function removeFromCart(bookId) {
  cart = cart.filter(c => c.id !== bookId);
  saveCart();
  updateCartBadge();
  renderCartSidebar();
  renderBooks();
}

function saveCart() {
  localStorage.setItem('eb_cart', JSON.stringify(cart));
}

function updateCartBadge() {
  const count = cart.length;
  ['cart-badge', 'mob-cart-badge'].forEach(id => {
    const el_ = el(id);
    if (!el_) return;
    el_.textContent = count;
    el_.classList.toggle('hidden', count === 0);
  });
}

function toggleCart() {
  const sidebar  = el('cart-sidebar');
  const overlay  = el('cart-overlay');
  const isHidden = sidebar.classList.contains('hidden');
  sidebar.classList.toggle('hidden', !isHidden);
  overlay.classList.toggle('hidden', !isHidden);
  if (!isHidden) {
    document.body.style.overflow = '';
  } else {
    renderCartSidebar();
    document.body.style.overflow = 'hidden';
  }
}

function renderCartSidebar() {
  const itemsEl  = el('cart-items');
  const emptyEl  = el('cart-empty');
  const footerEl = el('cart-footer');
  const countLbl = el('cart-count-label');

  if (!cart.length) {
    itemsEl.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    footerEl?.classList.add('hidden');
    if (countLbl) countLbl.textContent = '';
    return;
  }

  emptyEl?.classList.add('hidden');
  footerEl?.classList.remove('hidden');
  if (countLbl) countLbl.textContent = `(${cart.length})`;

  const total = cart.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0);
  el('cart-total').textContent = '₹' + total.toFixed(0);

  itemsEl.innerHTML = cart.map(book => {
    const thumb = book.thumbnail
      ? `<img src="${esc(book.thumbnail)}" alt="" />`
      : `<div class="cart-thumb-placeholder"></div>`;
    return `
      <div class="cart-item">
        <div class="cart-item-thumb">${thumb}</div>
        <div class="cart-item-info">
          <div class="cart-item-title">${esc(book.title)}</div>
          ${book.category ? `<div class="text-muted fs-xs">${esc(book.category)}</div>` : ''}
          <div class="cart-item-price">₹${(parseFloat(book.price) || 0).toFixed(0)}</div>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart('${book.id}')" aria-label="Remove">
          <svg viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>`;
  }).join('');
}

function buyNow(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  if (!currentUser) { openAuth('login'); return; }
  if (purchases.includes(bookId)) { showToast('You already own this book.', 'info'); return; }
  // Add to cart if not there, then open checkout
  if (!cart.some(c => c.id === bookId)) {
    cart.push(book);
    saveCart();
    updateCartBadge();
  }
  openCheckout([book]);
}

function proceedToCheckout() {
  if (!currentUser) { openAuth('login'); return; }
  if (!cart.length) return;
  toggleCart();
  openCheckout(cart);
}

/* ── CHECKOUT ─────────────────────────────────────────────────── */
function openCheckout(books) {
  checkoutCart        = books;
  checkoutCouponCode  = '';
  checkoutDiscount    = 0;
  checkoutScreenshot  = null;

  const total = books.reduce((s, b) => s + (parseFloat(b.price) || 0), 0);
  checkoutFinalTotal  = total;

  // Render summary
  el('checkout-summary').innerHTML = books.map(b => `
    <div class="checkout-item">
      <span class="checkout-item-title">${esc(b.title)}</span>
      <span class="checkout-item-price">₹${(parseFloat(b.price) || 0).toFixed(0)}</span>
    </div>`).join('');

  el('coupon-input').value    = '';
  el('coupon-status').classList.add('hidden');
  el('upload-label').textContent = 'Click to upload screenshot';
  el('upload-zone').classList.remove('uploaded');
  el('screenshot-input').value = '';
  el('upi-id-text').textContent = UPI_ID || 'UPI ID not configured';

  updateQR(total);

  renderPriceBreakdown(total, 0, total);

  el('checkout-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderPriceBreakdown(subtotal, discount, final) {
  el('price-breakdown').innerHTML = `
    <div class="price-row"><span>Subtotal</span><span>₹${subtotal.toFixed(0)}</span></div>
    ${discount > 0 ? `<div class="price-row discount"><span>Discount</span><span>−₹${discount.toFixed(0)}</span></div>` : ''}
    <div class="price-row total"><span>Total Payable</span><span>₹${final.toFixed(0)}</span></div>`;
}

async function applyCoupon() {
  const code = val('coupon-input').toUpperCase().trim();
  if (!code) { showToast('Enter a coupon code.', 'error'); return; }

  const statusEl = el('coupon-status');
  statusEl.textContent = 'Validating…';
  statusEl.className   = 'coupon-status';
  statusEl.classList.remove('hidden');

  try {
    const res    = await gas('validateCoupon', { code });
    const coupon = res.coupon;
    const sub    = checkoutCart.reduce((s, b) => s + (parseFloat(b.price) || 0), 0);
    let disc = 0;
    if (coupon.type === 'percent') {
      disc = Math.min((coupon.value / 100) * sub, sub);
    } else {
      disc = Math.min(coupon.value, sub);
    }
    disc = Math.round(disc);
    checkoutDiscount   = disc;
    checkoutFinalTotal = sub - disc;
    checkoutCouponCode = coupon.code;

    statusEl.textContent = `Coupon applied! You save ₹${disc}`;
    statusEl.classList.add('success');
    renderPriceBreakdown(sub, disc, checkoutFinalTotal);
    updateQR(checkoutFinalTotal);
  } catch (err) {
    checkoutDiscount   = 0;
    checkoutCouponCode = '';
    const sub = checkoutCart.reduce((s, b) => s + (parseFloat(b.price) || 0), 0);
    checkoutFinalTotal = sub;
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
    renderPriceBreakdown(sub, 0, sub);
    updateQR(sub);
  }
}

function updateQR(amount) {
  const upiId = UPI_ID || '';
  if (!upiId || upiId === 'YOUR_UPI_ID_HERE') return;
  const upiData = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('EduBooks')}&am=${amount}&cu=INR`;
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(upiData)}`;
  const qrImg   = el('qr-img');
  const qrOvImg = el('qr-overlay-img');
  if (qrImg)   qrImg.src   = qrUrl;
  if (qrOvImg) qrOvImg.src = qrUrl.replace('200x200', '400x400');
}

function enlargeQR() {
  const overlay = el('qr-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function copyUpi() {
  const upiId = UPI_ID || '';
  if (!upiId) { showToast('UPI ID not configured.', 'error'); return; }
  navigator.clipboard?.writeText(upiId).then(() => showToast('UPI ID copied!', 'success'))
    .catch(() => showToast('Could not copy — please copy manually.', 'info'));
}

function handleScreenshot(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Screenshot must be under 5 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    checkoutScreenshot = ev.target.result;
    el('upload-label').textContent = '✓ ' + file.name;
    el('upload-zone').classList.add('uploaded');
  };
  reader.readAsDataURL(file);
}

async function submitPayment() {
  if (!currentUser) { openAuth('login'); return; }
  if (!checkoutScreenshot) { showToast('Please upload a payment screenshot.', 'error'); return; }

  const btn = el('submit-payment-btn');
  setBtnLoading(btn, true, 'Submitting…');

  try {
    const bookIds = checkoutCart.map(b => b.id);
    await gas('submitPayment', {
      email:         currentUser.email,
      bookIds:       bookIds.join(','),
      totalAmount:   checkoutFinalTotal,
      coupon:        checkoutCouponCode,
      discount:      checkoutDiscount,
      screenshotBase64: checkoutScreenshot
    });

    closeModal('checkout-modal');
    // Remove purchased books from cart
    cart = cart.filter(c => !bookIds.includes(c.id));
    saveCart();
    updateCartBadge();
    renderBooks();
    showToast('Payment submitted! Admin will verify and grant access soon.', 'success');
  } catch (err) {
    showToast('Submission failed: ' + err.message, 'error');
  }
  setBtnLoading(btn, false, 'Submit Payment Request');
}

/* ── DASHBOARD ───────────────────────────────────────────────── */
function switchDashTab(tab, btn) {
  document.querySelectorAll('#page-dashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-dashboard .tab-panel').forEach(p => {
    p.classList.remove('active'); p.classList.add('hidden');
  });
  btn?.classList.add('active');
  const panel = el('dash-' + tab);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
}

async function loadDashboard() {
  if (!currentUser) return;

  try {
    purchases = await loadPurchases();
    const payments = (await gas('getPayments', { email: currentUser.email })).payments || [];
    const pending  = payments.filter(p => p.status === 'Pending');

    setText('stat-books',   purchases.length);
    setText('stat-pending', pending.length);

    // Library
    const ownedBooks = allBooks.filter(b => purchases.includes(b.id));
    const libGrid    = el('lib-grid');
    const libEmpty   = el('lib-empty');

    if (!ownedBooks.length) {
      if (libGrid)  libGrid.innerHTML = '';
      libEmpty?.classList.remove('hidden');
    } else {
      libEmpty?.classList.add('hidden');
      if (libGrid) {
        libGrid.innerHTML = ownedBooks.map(book => {
          const rating = parseFloat(book.rating) || 0;
          const thumb  = book.thumbnail
            ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy" />`
            : `<div class="book-placeholder"></div>`;
          return `
            <div class="book-card">
              <div class="book-thumb">${thumb}${book.category ? `<span class="cat-badge">${esc(book.category)}</span>` : ''}</div>
              <div class="book-body">
                <h3 class="book-title">${esc(book.title)}</h3>
                <div class="book-meta">
                  <div class="book-rating">${renderStars(rating)}<span class="rating-val">${rating > 0 ? rating.toFixed(1) : 'New'}</span></div>
                </div>
                <div class="book-actions mt-sm">
                  <button class="btn btn-primary w-full" onclick="openReader('${book.id}')">Read Now</button>
                </div>
              </div>
            </div>`;
        }).join('');
      }
    }

    // Orders
    const ordersList  = el('orders-list');
    const ordersEmpty = el('orders-empty');
    if (!payments.length) {
      if (ordersList) ordersList.innerHTML = '';
      ordersEmpty?.classList.remove('hidden');
    } else {
      ordersEmpty?.classList.add('hidden');
      if (ordersList) {
        ordersList.innerHTML = `
          <div class="orders-table-wrap">
            <table class="data-table">
              <thead><tr><th>Books</th><th>Amount</th><th>Coupon</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>${payments.map(p => {
                const bookTitles = (p.bookIds || p.bookId || '').split(',').map(bid => {
                  const b = allBooks.find(bk => bk.id === bid.trim());
                  return b ? esc(b.title) : bid.trim();
                }).join(', ');
                const statusClass = p.status === 'Approved' ? 'approved' : p.status === 'Rejected' ? 'rejected' : 'pending';
                return `<tr>
                  <td>${bookTitles}</td>
                  <td>₹${parseFloat(p.totalAmount || p.amount || 0).toFixed(0)}</td>
                  <td>${p.coupon || '—'}</td>
                  <td><span class="status-badge ${statusClass}">${p.status}</span></td>
                  <td class="text-muted fs-xs">${formatDate(p.submittedAt)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>`;
      }
    }

    renderBooks();
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

/* ── ADMIN ───────────────────────────────────────────────────── */
function switchAdminTab(tab, btn) {
  document.querySelectorAll('#page-admin .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-admin .tab-panel').forEach(p => {
    p.classList.remove('active'); p.classList.add('hidden');
  });
  btn?.classList.add('active');
  const panel = el('admin-' + tab);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }

  if (tab === 'orders')   loadAdminOrders();
  if (tab === 'books')    loadAdminBooks();
  if (tab === 'coupons')  loadAdminCoupons();
  if (tab === 'users')    loadAdminUsers();
}

async function loadAdmin() {
  if (!adminCreds) return;
  try {
    const a = await gas('getAnalytics', adminCreds);
    setText('a-users',   a.totalUsers);
    setText('a-books',   a.totalBooks);
    setText('a-sales',   a.totalSales);
    setText('a-revenue', '₹' + (parseFloat(a.totalRevenue) || 0).toFixed(0));
    setText('a-pending', a.pendingCount);
  } catch (err) { showToast('Analytics error: ' + err.message, 'error'); }
  loadAdminOrders();
}

async function loadAdminOrders() {
  if (!adminCreds) return;
  el('admin-orders-loading')?.classList.remove('hidden');
  el('admin-orders-list')?.classList.add('hidden');
  el('admin-orders-empty')?.classList.add('hidden');
  try {
    const res      = await gas('getAllPayments', adminCreds);
    const payments = res.payments || [];
    const books    = res.books    || [];

    el('admin-orders-loading')?.classList.add('hidden');

    if (!payments.length) {
      el('admin-orders-empty')?.classList.remove('hidden');
      return;
    }

    const list = el('admin-orders-list');
    list.innerHTML = `
      <div class="orders-table-wrap">
        <table class="data-table">
          <thead><tr><th>User</th><th>Books</th><th>Amount</th><th>Coupon</th><th>Status</th><th>Screenshot</th><th>Actions</th></tr></thead>
          <tbody>${payments.map(p => {
            const bookTitles = (p.bookIds || p.bookId || '').split(',').map(bid => {
              const b = books.find(bk => bk.id === bid.trim());
              return b ? esc(b.title) : bid.trim();
            }).join(', ');
            const sc = p.screenshotUrl && p.screenshotUrl !== 'upload_failed'
              ? `<a href="${esc(p.screenshotUrl)}" target="_blank" class="link-btn">View</a>`
              : '<span class="text-muted">—</span>';
            const statusClass = p.status === 'Approved' ? 'approved' : p.status === 'Rejected' ? 'rejected' : 'pending';
            const actions = p.status === 'Pending' ? `
              <button class="btn btn-ghost btn-sm" onclick="adminApprove('${p.id}')">Approve</button>
              <button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="adminReject('${p.id}')">Reject</button>
            ` : `<span class="status-badge ${statusClass}">${p.status}</span>`;
            return `<tr>
              <td class="fs-sm">${esc(p.userEmail)}</td>
              <td class="fs-sm">${bookTitles}</td>
              <td>₹${parseFloat(p.totalAmount || p.amount || 0).toFixed(0)}</td>
              <td class="fs-sm">${p.coupon || '—'}</td>
              <td><span class="status-badge ${statusClass}">${p.status}</span></td>
              <td>${sc}</td>
              <td class="actions-cell">${actions}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
    list.classList.remove('hidden');
  } catch (err) {
    el('admin-orders-loading')?.classList.add('hidden');
    showToast('Failed to load orders: ' + err.message, 'error');
  }
}

async function loadAdminBooks() {
  if (!adminCreds) return;
  el('admin-books-loading')?.classList.remove('hidden');
  el('admin-books-list')?.classList.add('hidden');
  try {
    const res   = await gas('getBooks');
    const books = res.books || [];
    el('admin-books-loading')?.classList.add('hidden');
    const list = el('admin-books-list');
    if (!books.length) {
      list.innerHTML = '<div class="text-center text-muted p-lg">No books yet. Use "Add Book" tab to add books.</div>';
      list.classList.remove('hidden');
      return;
    }
    list.innerHTML = `
      <div class="orders-table-wrap">
        <table class="data-table">
          <thead><tr><th>Cover</th><th>Title</th><th>Category</th><th>Price</th><th>Rating</th><th>Sold</th><th>Actions</th></tr></thead>
          <tbody>${books.map(b => {
            const thumb = b.thumbnail ? `<img src="${esc(b.thumbnail)}" class="table-thumb" alt="" />` : '<div class="table-thumb-placeholder"></div>';
            return `<tr>
              <td>${thumb}</td>
              <td class="fw-500 fs-sm">${esc(b.title)}</td>
              <td><span class="cat-badge">${esc(b.category || 'Other')}</span></td>
              <td>₹${parseFloat(b.price || 0).toFixed(0)}</td>
              <td>${parseFloat(b.rating || 0).toFixed(1)} ★</td>
              <td>${parseInt(b.salesCount) || 0}</td>
              <td><button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="adminDeleteBook('${b.id}', '${esc(b.title).replace(/'/g, "\\'")}')">Delete</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
    list.classList.remove('hidden');
  } catch (err) {
    el('admin-books-loading')?.classList.add('hidden');
    showToast('Failed to load books: ' + err.message, 'error');
  }
}

async function loadAdminCoupons() {
  if (!adminCreds) return;
  try {
    const res     = await gas('getCoupons', adminCreds);
    const coupons = res.coupons || [];
    const list    = el('coupons-list');
    if (!coupons.length) {
      list.innerHTML = '<div class="text-center text-muted p-lg">No coupons yet.</div>';
      return;
    }
    list.innerHTML = `
      <div class="orders-table-wrap">
        <table class="data-table">
          <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Expiry</th><th>Status</th><th>Used</th><th>Actions</th></tr></thead>
          <tbody>${coupons.map(c => {
            const valStr = c.type === 'percent' ? `${c.value}%` : `₹${c.value}`;
            const statusClass = c.status === 'active' ? 'approved' : 'rejected';
            return `<tr>
              <td class="fw-600 fs-sm">${esc(c.code)}</td>
              <td class="fs-sm">${c.type === 'percent' ? 'Percentage' : 'Fixed'}</td>
              <td>${valStr}</td>
              <td class="fs-sm text-muted">${c.expiry || '—'}</td>
              <td><span class="status-badge ${statusClass}">${c.status}</span></td>
              <td class="text-muted">${parseInt(c.usageCount) || 0}</td>
              <td><button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="adminDeleteCoupon('${esc(c.code)}')">Delete</button></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    showToast('Failed to load coupons: ' + err.message, 'error');
  }
}

async function loadAdminUsers() {
  if (!adminCreds) return;
  el('admin-users-loading')?.classList.remove('hidden');
  el('admin-users-list')?.classList.add('hidden');
  try {
    const res   = await gas('getAllUsers', adminCreds);
    const users = res.users || [];
    el('admin-users-loading')?.classList.add('hidden');
    const list = el('admin-users-list');
    if (!users.length) {
      list.innerHTML = '<div class="text-center text-muted p-lg">No users yet.</div>';
      list.classList.remove('hidden');
      return;
    }
    list.innerHTML = `
      <div class="orders-table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>${users.map(u => `<tr>
            <td class="fw-500 fs-sm">${esc(u.name || '—')}</td>
            <td class="fs-sm text-muted">@${esc(u.username || '—')}</td>
            <td class="fs-sm">${esc(u.email)}</td>
            <td><span class="badge-role${u.role === 'admin' ? ' admin' : ''}">${esc(u.role)}</span></td>
            <td class="fs-xs text-muted">${formatDate(u.joinedAt)}</td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    list.classList.remove('hidden');
  } catch (err) {
    el('admin-users-loading')?.classList.add('hidden');
    showToast('Failed to load users: ' + err.message, 'error');
  }
}

/* ── ADMIN ACTIONS ───────────────────────────────────────────── */
async function adminApprove(paymentId) {
  if (!confirm('Approve this payment and grant book access?')) return;
  try {
    await gas('approvePayment', { ...adminCreds, paymentId });
    showToast('Payment approved.', 'success');
    loadAdminOrders();
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); }
}

async function adminReject(paymentId) {
  if (!confirm('Reject this payment?')) return;
  try {
    await gas('rejectPayment', { ...adminCreds, paymentId });
    showToast('Payment rejected.', 'info');
    loadAdminOrders();
  } catch (err) { showToast(err.message, 'error'); }
}

async function submitAddBook() {
  const btn = el('add-book-btn');
  const title = val('b-title');
  const price = val('b-price');
  const pdf   = val('b-pdf');
  if (!title || !pdf) { showToast('Title and PDF URL are required.', 'error'); return; }
  if (!price || parseFloat(price) <= 0) { showToast('Please enter a valid price.', 'error'); return; }
  setBtnLoading(btn, true, 'Adding…');
  try {
    await gas('addBook', {
      ...adminCreds,
      title,
      price,
      pdf,
      description: val('b-desc'),
      thumbnail:   val('b-thumb'),
      keywords:    val('b-keywords'),
      category:    el('b-category')?.value || 'Other',
      rating:      val('b-rating') || 0
    });
    clearInputs(['b-title', 'b-price', 'b-pdf', 'b-desc', 'b-thumb', 'b-keywords', 'b-rating']);
    showToast('Book added successfully!', 'success');
    loadBooks();
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); }
  setBtnLoading(btn, false, 'Add Book');
}

async function adminDeleteBook(bookId, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    await gas('deleteBook', { ...adminCreds, bookId });
    showToast('Book deleted.', 'info');
    loadBooks();
    loadAdminBooks();
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); }
}

async function submitAddCoupon() {
  const code   = val('c-code').toUpperCase();
  const type   = el('c-type')?.value || 'percent';
  const value  = val('c-value');
  const expiry = val('c-expiry');
  if (!code || !value || !expiry) { showToast('All coupon fields are required.', 'error'); return; }
  try {
    await gas('addCoupon', { ...adminCreds, code, type, value, expiry });
    clearInputs(['c-code', 'c-value', 'c-expiry']);
    showToast('Coupon created!', 'success');
    loadAdminCoupons();
  } catch (err) { showToast(err.message, 'error'); }
}

async function adminDeleteCoupon(code) {
  if (!confirm(`Delete coupon "${code}"?`)) return;
  try {
    await gas('deleteCoupon', { ...adminCreds, code });
    showToast('Coupon deleted.', 'info');
    loadAdminCoupons();
  } catch (err) { showToast(err.message, 'error'); }
}

/* ── RATING MODAL ────────────────────────────────────────────── */
function openRateModal(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  const existing = `<div class="modal-overlay" id="rate-modal" onclick="closeModal('rate-modal', event)">
    <div class="modal">
      <div class="modal-body">
        <h2 class="modal-title">Rate this Book</h2>
        <p class="text-muted fs-sm mb-lg">${esc(book.title)}</p>
        <div class="rate-stars" id="rate-stars">
          ${[1,2,3,4,5].map(i => `<button class="rate-star" onclick="setRating(${i}, '${bookId}')" data-val="${i}">★</button>`).join('')}
        </div>
        <p class="text-muted fs-xs mt-sm" id="rate-label">Select a rating</p>
        <button class="btn btn-primary w-full mt-md" id="rate-submit-btn" onclick="submitRating('${bookId}')" disabled>Submit Rating</button>
      </div>
      <button class="modal-close" onclick="closeModal('rate-modal')" aria-label="Close">
        <svg viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', existing);
}

let selectedRating = 0;
function setRating(val, bookId) {
  selectedRating = val;
  document.querySelectorAll('.rate-star').forEach((s, i) => {
    s.classList.toggle('active', i < val);
  });
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
  setText('rate-label', labels[val] || '');
  const submitBtn = el('rate-submit-btn');
  if (submitBtn) submitBtn.disabled = false;
}

async function submitRating(bookId) {
  if (!selectedRating || !currentUser) return;
  const btn = el('rate-submit-btn');
  setBtnLoading(btn, true, 'Submitting…');
  try {
    await gas('rateBook', { email: currentUser.email, bookId, rating: selectedRating });
    closeModal('rate-modal');
    el('rate-modal')?.remove();
    showToast('Rating submitted!', 'success');
    loadBooks();
  } catch (err) { showToast(err.message, 'error'); }
  setBtnLoading(btn, false, 'Submit Rating');
}

/* ── MODALS ───────────────────────────────────────────────────── */
function closeModal(id, event) {
  if (event && event.target !== el(id)) return;
  const modal = el(id);
  if (modal) {
    modal.classList.add('hidden');
    if (id === 'preview-modal') el('preview-iframe').src = '';
    if (['checkout-modal', 'preview-modal', 'auth-modal'].includes(id)) {
      document.body.style.overflow = '';
    }
  }
}

/* ── TOAST ────────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const container = el('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">
      <svg viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 4000);
}

/* ── UTILS ────────────────────────────────────────────────────── */
function el(id)            { return document.getElementById(id); }
function val(id)           { return (el(id)?.value || '').trim(); }
function setText(id, text) { const e = el(id); if (e) e.textContent = text; }
function toggle(id, show)  {
  const e = el(id);
  if (!e) return;
  if (show) e.classList.remove('hidden');
  else      e.classList.add('hidden');
}
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function clearInputs(ids) {
  ids.forEach(id => { const e = el(id); if (e) e.value = ''; });
}
function setBtnLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled     = loading;
  btn.textContent  = text;
}
function formatDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return str; }
}
