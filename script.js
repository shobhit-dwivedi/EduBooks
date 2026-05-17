/* ═══════════════════════════════════════════════════════════════
   EduBooks — script.js

   SETUP (2 things to fill in):
   1. GAS_URL  → paste your deployed Google Apps Script Web App URL
   2. UPI_ID   → paste your UPI payment ID  (e.g. yourname@upi)
═══════════════════════════════════════════════════════════════ */

// ── CONFIG ────────────────────────────────────────────────────
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyCoigDwTyCnkqURmOphzQ9BYUKYwIalWDkDHodx_TqLGXi1VeEpis5Xa_qD8tVFIQO/exec';
const UPI_ID  = 'ganeshkumardwivedi90@oksbi';

// ── STATE ─────────────────────────────────────────────────────
let currentUser       = null;
let adminCreds        = null;
let allBooks          = [];
let filteredBooks     = [];
let purchases         = [];      // array of bookIds the current user owns
let currentFilter     = 'all';
let cart              = [];      // array of book objects

// Payment modal state
let pmBook            = null;
let pmFinalPrice      = 0;
let pmCouponCode      = '';
let pmIsFree          = false;
let pmIsFirstBookFree = false;

// Book detail modal state
let bmBook            = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('eb_theme') || 'light');

  if (!GAS_URL || GAS_URL === 'YOUR_GAS_SCRIPT_URL_HERE') {
    el('setup-banner')?.classList.remove('hidden');
  }

  // Restore cart from localStorage
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
    if (drop && !drop.classList.contains('hidden') && trig && !trig.contains(e.target) && !drop.contains(e.target))
      drop.classList.add('hidden');
  });
});

// ── GAS HELPER ────────────────────────────────────────────────
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
    throw new Error('Network error — check internet connection and GAS URL.');
  }
  let json;
  try { json = JSON.parse(text); } catch {
    console.error('GAS non-JSON:', text.slice(0, 300));
    throw new Error('Server error. Re-deploy GAS as Web App (Execute as: Me, Anyone).');
  }
  if (json.success === false || json.error) throw new Error(json.error || 'Request failed.');
  return json;
}

// ── THEME ─────────────────────────────────────────────────────
function toggleTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(t);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('eb_theme', t);
  const btn = el('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

// ── SESSION ───────────────────────────────────────────────────
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
  const isAdmin = user.role === 'admin';
  const initials = getInitials(user.name || user.username || 'U');

  toggle('auth-logged-out', false);
  toggle('auth-logged-in',  true);
  // Hide hamburger auth buttons when logged in
  toggle('mob-auth-out', false);
  toggle('mob-signout',  true);
  toggle('mob-dash-link', !isAdmin);
  toggle('mob-admin-link', isAdmin);

  setText('user-initials',   initials);
  setText('drop-initials',   initials);
  setText('drop-name',       user.name || user.username);
  setText('drop-email',      user.email);

  const rb = el('drop-role-badge');
  if (rb) { rb.textContent = isAdmin ? 'Admin' : 'Buyer'; rb.className = 'role-badge' + (isAdmin ? ' admin' : ''); }

  toggle('admin-nav-link', isAdmin);

  // Dash
  const dc = el('dash-initials-circle');
  if (dc) dc.textContent = initials;
  setText('dash-name',  user.name || user.username);
  setText('dash-email', user.email);
  const drb = el('dash-role-badge');
  if (drb) { drb.textContent = user.role; drb.className = 'role-badge' + (isAdmin ? ' admin' : ''); }
  // Profile
  const pc = el('profile-initials-circle');
  if (pc) pc.textContent = initials;
  setText('profile-name',     user.name || user.username);
  setText('profile-email',    user.email);
  setText('profile-username', '@' + (user.username || ''));
  const prb = el('profile-role');
  if (prb) { prb.textContent = user.role || 'buyer'; prb.className = 'role-badge' + (isAdmin ? ' admin' : ''); }
}

function signOut() {
  currentUser = null; adminCreds = null; purchases = [];
  localStorage.removeItem('eb_session');
  toggle('auth-logged-in',  false);
  toggle('auth-logged-out', true);
  toggle('mob-auth-out',    true);
  toggle('mob-signout',     false);
  toggle('mob-dash-link',   false);
  toggle('mob-admin-link',  false);
  closeMobileMenu();
  showPage('home');
  showToast('Signed out.', 'info');
  renderBooks(filteredBooks);
}

// ── PAGES ─────────────────────────────────────────────────────
function showPage(page) {
  if (page === 'dashboard' && !currentUser)  { openAuth('login'); return; }
  if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Admin access only.', 'error'); return;
  }
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active'); p.classList.add('hidden');
  });
  const pageEl = el('page-' + page);
  if (pageEl) {
    pageEl.classList.remove('hidden');
    pageEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (page === 'dashboard') loadDashboard();
  if (page === 'admin')     loadAdmin();
}

// ── MOBILE MENU ───────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = el('mobile-menu');
  const btn  = el('hamburger-btn');
  const open = menu.classList.contains('hidden');
  if (open) {
    menu.classList.remove('hidden');
    btn?.classList.add('open');
  } else {
    closeMobileMenu();
  }
}
function closeMobileMenu() {
  el('mobile-menu')?.classList.add('hidden');
  el('hamburger-btn')?.classList.remove('open');
}

// ── AUTH MODAL ────────────────────────────────────────────────
function openAuth(tab) {
  el('auth-modal').classList.remove('hidden');
  switchAuthTab(tab || 'login');
}
function closeAuthModal(event) {
  if (!event || event.target === el('auth-modal'))
    el('auth-modal').classList.add('hidden');
}
function switchAuthTab(tab) {
  ['login', 'register', 'admin'].forEach(t => {
    el('tab-' + t)?.classList.toggle('active', t === tab);
    el('form-' + t)?.classList.toggle('hidden', t !== tab);
  });
}

// ── REGISTER ──────────────────────────────────────────────────
async function submitRegister() {
  const btn = el('register-btn');
  const name     = el('reg-name').value.trim();
  const username = el('reg-username').value.trim();
  const email    = el('reg-email').value.trim();
  const password = el('reg-password').value;
  if (!name || !username || !email || !password) { showToast('Please fill in all fields.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  setBtn(btn, true, 'Creating…');
  try {
    const res  = await gas('registerBuyer', { name, username, email, password });
    const user = res.user;
    if (!user?.email) { showToast('Registration failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    el('auth-modal').classList.add('hidden');
    clearInputs(['reg-name', 'reg-username', 'reg-email', 'reg-password']);
    purchases = [];
    renderBooks(filteredBooks);
    showToast('Welcome ' + (user.name || user.username) + '! 🎉 Your first book is FREE!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  setBtn(btn, false, 'Create Account');
}

// ── LOGIN ─────────────────────────────────────────────────────
async function submitLogin() {
  const btn      = el('login-btn');
  const email    = el('login-email').value.trim();
  const password = el('login-password').value;
  if (!email || !password) { showToast('Enter your email and password.', 'error'); return; }
  setBtn(btn, true, 'Signing in…');
  try {
    const res  = await gas('loginBuyer', { email, password });
    const user = res.user;
    if (!user?.email) { showToast('Login failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    el('auth-modal').classList.add('hidden');
    clearInputs(['login-email', 'login-password']);
    purchases = await loadPurchases();
    renderBooks(filteredBooks);
    const msg = purchases.length === 0
      ? 'Welcome back! Your first book is still FREE 🎉'
      : 'Welcome back, ' + (user.name || user.username) + '!';
    showToast(msg, 'success');
  } catch (err) { showToast(err.message, 'error'); }
  setBtn(btn, false, 'Sign In');
}

// ── ADMIN LOGIN ───────────────────────────────────────────────
async function submitAdminLogin() {
  const btn      = el('admin-login-btn');
  const username = el('admin-username').value.trim();
  const password = el('admin-password').value;
  if (!username || !password) { showToast('Enter admin credentials.', 'error'); return; }
  setBtn(btn, true, 'Checking…');
  try {
    const res  = await gas('checkAdmin', { username, password });
    const user = res.user;
    if (!user?.email) { showToast('Admin login failed.', 'error'); return; }
    const creds = { adminUsername: username, adminPassword: password };
    localStorage.setItem('eb_session', JSON.stringify({ user, adminCreds: creds }));
    setCurrentUser(user, creds);
    el('auth-modal').classList.add('hidden');
    clearInputs(['admin-username', 'admin-password']);
    showToast('Admin access granted.', 'success');
    showPage('admin');
  } catch (err) { showToast(err.message, 'error'); }
  setBtn(btn, false, 'Admin Login');
}

function togglePw(inputId, btn) {
  const input = el(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}
function toggleUserMenu() { el('user-dropdown').classList.toggle('hidden'); }
function closeUserMenu()   { el('user-dropdown').classList.add('hidden'); }

// ── BOOKS ─────────────────────────────────────────────────────
async function loadBooks() {
  try {
    const res     = await gas('getBooks');
    allBooks      = Array.isArray(res.books) ? res.books : [];
    filteredBooks = [...allBooks];
    if (currentUser && currentUser.role !== 'admin') purchases = await loadPurchases();
    renderBooks(filteredBooks);
  } catch {
    el('books-loading').classList.add('hidden');
    el('books-empty').classList.remove('hidden');
  }
}

async function loadPurchases() {
  if (!currentUser || currentUser.role === 'admin') return [];
  try {
    const res = await gas('getPurchases', { email: currentUser.email });
    return Array.isArray(res.purchases) ? res.purchases.map(p => p.bookId) : [];
  } catch { return []; }
}

function renderBooks(books) {
  el('books-loading').classList.add('hidden');
  const grid  = el('books-grid');
  const empty = el('books-empty');
  if (!books || books.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = books.map((b, i) => buildBookCard(b, i)).join('');
}

function buildBookCard(book, idx) {
  const isFreeBook  = String(book.type).toLowerCase() === 'free';
  const isPurchased = purchases.includes(book.id);
  const price       = parseFloat(book.price) || 0;

  // First book free logic:
  // - Not logged in → show as free (they'll need to login when they click)
  // - Logged in + 0 purchases → first book is free
  // - Logged in + has purchases → show real price
  const isNewUser  = !currentUser || purchases.length === 0;
  const showAsFree = isFreeBook || (isNewUser && !isPurchased);

  const kws = book.keywords ? book.keywords.split(',').slice(0, 3) : [];

  // Cover image or placeholder
  const coverImg = book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy" /><div class="book-cover-placeholder" style="display:none">📖</div>`
    : `<div class="book-cover-placeholder">📖</div>`;

  // Badge
  const badgeClass = showAsFree ? 'cover-badge-free' : 'cover-badge-premium';
  const badgeText  = showAsFree ? 'Free' : 'Premium';

  // Price tag overlay
  let priceTag;
  if (isPurchased) {
    priceTag = `<span class="cover-price is-free">✅ Owned</span>`;
  } else if (isFreeBook) {
    priceTag = price > 0
      ? `<span class="cover-price is-free"><s class="cover-free-orig">₹${price}</s>FREE</span>`
      : `<span class="cover-price is-free">FREE</span>`;
  } else if (isNewUser) {
    priceTag = `<span class="cover-price is-free"><s class="cover-free-orig">₹${price}</s>FREE</span>`;
  } else {
    priceTag = `<span class="cover-price">₹${price}</span>`;
  }

  // Action buttons
  let primaryBtn, cartBtn;
  if (isPurchased) {
    primaryBtn = `<button class="btn btn-success" onclick="openPdf('${esc(book.id)}');event.stopPropagation()">📖 Read Now</button>`;
    cartBtn    = '';
  } else if (showAsFree) {
    primaryBtn = `<button class="btn btn-primary" onclick="openPaymentModal('${esc(book.id)}');event.stopPropagation()">🎉 Get Free</button>`;
    cartBtn    = `<button class="btn btn-ghost btn-cart-sm" title="Add to Cart" onclick="addToCart('${esc(book.id)}');event.stopPropagation()">🛒</button>`;
  } else {
    primaryBtn = `<button class="btn btn-primary" onclick="openPaymentModal('${esc(book.id)}');event.stopPropagation()">Buy ₹${price}</button>`;
    cartBtn    = `<button class="btn btn-ghost btn-cart-sm" title="Add to Cart" onclick="addToCart('${esc(book.id)}');event.stopPropagation()">🛒</button>`;
  }

  const kwHtml = kws.map(k => `<span class="kw-tag">${esc(k.trim())}</span>`).join('');

  return `
    <div class="book-card" style="animation-delay:${idx * 0.06}s" onclick="openBookDetail('${esc(book.id)}')">
      <div class="book-cover">
        ${coverImg}
        <span class="cover-badge ${badgeClass}">${badgeText}</span>
        ${priceTag}
      </div>
      <div class="book-body">
        <h3 class="book-title">${esc(book.title)}</h3>
        <p class="book-desc">${esc(book.description || 'No description available.')}</p>
        ${kwHtml ? `<div class="book-kws">${kwHtml}</div>` : ''}
        <div class="book-footer">
          ${primaryBtn}${cartBtn}
        </div>
      </div>
    </div>`;
}

// ── BOOK DETAIL MODAL ─────────────────────────────────────────
function openBookDetail(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  bmBook = book;

  const isFreeBook  = String(book.type).toLowerCase() === 'free';
  const isPurchased = purchases.includes(book.id);
  const isNewUser   = !currentUser || purchases.length === 0;
  const showAsFree  = isFreeBook || (isNewUser && !isPurchased);
  const price       = parseFloat(book.price) || 0;

  // Cover
  const thumbEl = el('bm-thumb');
  const phEl    = el('bm-placeholder');
  if (book.thumbnail) {
    thumbEl.src = book.thumbnail;
    thumbEl.style.display = 'block';
    phEl.classList.add('hidden');
  } else {
    thumbEl.style.display = 'none';
    phEl.classList.remove('hidden');
  }

  // Badge
  const badgeEl = el('bm-badge');
  if (showAsFree) {
    badgeEl.textContent = 'Free'; badgeEl.className = 'role-badge free';
  } else {
    badgeEl.textContent = 'Premium'; badgeEl.className = 'role-badge premium';
  }

  // Price display
  const priceEl = el('bm-price-display');
  if (isPurchased) {
    priceEl.textContent = '✅ Owned';
    priceEl.style.color = 'var(--success)';
  } else if (showAsFree) {
    priceEl.innerHTML = price > 0
      ? `<s style="opacity:0.5;font-size:0.85em">₹${price}</s> FREE`
      : 'FREE';
    priceEl.style.color = 'var(--success)';
  } else {
    priceEl.textContent = '₹' + price;
    priceEl.style.color = 'var(--primary)';
  }

  setText('bm-title', book.title);
  setText('bm-desc', book.description || 'No description available.');

  // Keywords
  const kwEl = el('bm-keywords');
  const kws  = book.keywords ? book.keywords.split(',').slice(0, 5) : [];
  kwEl.innerHTML = kws.map(k => `<span class="kw-tag">${esc(k.trim())}</span>`).join('');

  // Buttons
  const buyBtn  = el('bm-buy-btn');
  const cartBtn = el('bm-cart-btn');
  if (isPurchased) {
    buyBtn.textContent = '📖 Read Now';
    buyBtn.className   = 'btn btn-success flex-1';
    cartBtn.style.display = 'none';
  } else if (showAsFree) {
    buyBtn.textContent = '🎉 Get Free';
    buyBtn.className   = 'btn btn-primary flex-1';
    cartBtn.style.display = '';
  } else {
    buyBtn.textContent = `Buy — ₹${price}`;
    buyBtn.className   = 'btn btn-primary flex-1';
    cartBtn.style.display = '';
  }

  el('book-modal').classList.remove('hidden');
}

function bm_buy() {
  if (!bmBook) return;
  el('book-modal').classList.add('hidden');
  if (purchases.includes(bmBook.id)) {
    openPdf(bmBook.id);
  } else {
    openPaymentModal(bmBook.id);
  }
}
function bm_cart() {
  if (!bmBook) return;
  addToCart(bmBook.id);
}
function closeBookModal(event) {
  if (!event || event.target === el('book-modal'))
    el('book-modal').classList.add('hidden');
}

// ── CART ──────────────────────────────────────────────────────
function addToCart(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;
  if (cart.find(c => c.id === bookId)) { showToast('Already in cart.', 'info'); return; }
  if (purchases.includes(bookId)) { showToast('You already own this book.', 'info'); return; }
  cart.push(book);
  saveCart();
  updateCartBadge();
  showToast('"' + book.title + '" added to cart!', 'success');
}

function removeFromCart(bookId) {
  cart = cart.filter(c => c.id !== bookId);
  saveCart();
  updateCartBadge();
  renderCartItems();
}

function saveCart() {
  localStorage.setItem('eb_cart', JSON.stringify(cart));
}

function updateCartBadge() {
  const count = cart.length;
  const badge = el('cart-count');
  const mobBadge = el('mob-cart-count');
  if (badge)    { badge.textContent = count; count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden'); }
  if (mobBadge) mobBadge.textContent = count;
}

function openCart() {
  renderCartItems();
  el('cart-modal').classList.remove('hidden');
}
function closeCart(event) {
  if (!event || event.target === el('cart-modal'))
    el('cart-modal').classList.add('hidden');
}

function renderCartItems() {
  const itemsEl  = el('cart-items');
  const emptyEl  = el('cart-empty');
  const footerEl = el('cart-footer');

  if (cart.length === 0) {
    itemsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    footerEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  footerEl.classList.remove('hidden');

  const isNewUser = !currentUser || purchases.length === 0;

  itemsEl.innerHTML = cart.map(book => {
    const isFreeBook = String(book.type).toLowerCase() === 'free';
    const showAsFree = isFreeBook || (isNewUser && !purchases.includes(book.id));
    const price      = parseFloat(book.price) || 0;
    const priceText  = showAsFree ? 'FREE' : '₹' + price;
    return `
      <div class="cart-item">
        ${book.thumbnail
          ? `<img class="cart-item-img" src="${esc(book.thumbnail)}" alt="" onerror="this.style.background='var(--bg3)';this.src=''" />`
          : `<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.4rem">📖</div>`}
        <div class="cart-item-info">
          <strong>${esc(book.title)}</strong>
          <span>${priceText}</span>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart('${esc(book.id)}')" title="Remove">✕</button>
      </div>`;
  }).join('');

  // Calculate total
  let total = 0;
  cart.forEach(book => {
    const isFreeBook = String(book.type).toLowerCase() === 'free';
    const showAsFree = isFreeBook || (isNewUser && !purchases.includes(book.id));
    if (!showAsFree) total += parseFloat(book.price) || 0;
  });

  setText('cart-total-display', total === 0 ? 'FREE' : '₹' + total);
}

function checkoutCart() {
  if (cart.length === 0) return;
  // If there's only 1 item, open its payment modal directly
  if (cart.length === 1) {
    const bookId = cart[0].id;
    el('cart-modal').classList.add('hidden');
    openPaymentModal(bookId);
    return;
  }
  showToast('Multi-book checkout coming soon! Buy individually for now.', 'info');
}

// ── SEARCH & FILTER ───────────────────────────────────────────
function handleSearch(event) {
  const q = event?.target?.value?.toLowerCase() || '';
  // Sync both search inputs
  const heroInput = el('hero-search');
  const mobInput  = document.querySelector('.mobile-search-input');
  if (event?.target !== heroInput && heroInput) heroInput.value = q;
  if (event?.target !== mobInput  && mobInput)  mobInput.value  = q;
  applyFilter(q);
}

function applyFilter(q) {
  let res = [...allBooks];
  if (currentFilter !== 'all') res = res.filter(b => String(b.type).toLowerCase() === currentFilter);
  if (q) res = res.filter(b =>
    (b.title || '').toLowerCase().includes(q) ||
    (b.keywords || '').toLowerCase().includes(q) ||
    (b.description || '').toLowerCase().includes(q)
  );
  filteredBooks = res;
  renderBooks(filteredBooks);
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter((el('hero-search') || { value: '' }).value.toLowerCase());
}

// ── PAYMENT MODAL ─────────────────────────────────────────────
function openPaymentModal(bookId) {
  if (!currentUser) { showToast('Please login to continue.', 'info'); openAuth('login'); return; }
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  pmBook       = book;
  pmCouponCode = '';

  const isFreeBook  = String(book.type).toLowerCase() === 'free';
  // First book free: user has 0 purchases and hasn't purchased this one yet
  pmIsFirstBookFree = (purchases.length === 0 && !isFreeBook && !purchases.includes(bookId));
  const effectivelyFree = isFreeBook || pmIsFirstBookFree || purchases.length === 0 && !purchases.includes(bookId);
  // Simplified: if user has 0 total purchases → this book is free (regardless of type)
  // If user already has purchases → charge normal price
  const isFirstTimerFree = purchases.length === 0 && !purchases.includes(bookId);

  pmIsFree     = isFreeBook || isFirstTimerFree;
  pmFinalPrice = pmIsFree ? 0 : (parseFloat(book.price) || 0);

  // Populate book info
  setText('pm-title', book.title);
  setText('pm-desc',  book.description || '');
  const thumbEl = el('pm-thumb');
  if (thumbEl) { thumbEl.src = book.thumbnail || ''; thumbEl.style.display = book.thumbnail ? 'block' : 'none'; }

  // Reset coupon
  const ci = el('coupon-input'), cm = el('coupon-msg');
  if (ci) ci.value = '';
  if (cm) { cm.textContent = ''; cm.className = 'coupon-msg'; }
  el('pm-discount-row')?.classList.add('hidden');

  // Reset screenshot
  const si = el('screenshot-input');
  if (si) si.value = '';
  el('screenshot-preview')?.classList.add('hidden');
  el('upload-placeholder')?.classList.remove('hidden');

  refreshPaymentModal();
  el('payment-modal').classList.remove('hidden');
}

function refreshPaymentModal() {
  const isFree    = pmIsFree || pmFinalPrice === 0;
  const origPrice = parseFloat(pmBook?.price) || 0;

  // Free notice
  const notice = el('pm-free-notice');
  if (notice) {
    if (pmIsFirstBookFree) {
      notice.innerHTML = '🎉 <strong>First Book Free!</strong> Get instant access — no payment required!';
      notice.classList.remove('hidden');
    } else if (String(pmBook?.type).toLowerCase() === 'free') {
      notice.innerHTML = '✅ <strong>This book is Free!</strong> Instant access — no payment needed.';
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }
  }

  // Show/hide payment sections
  toggle('pm-qr-section',     !isFree);
  toggle('pm-coupon-section', !isFree);
  toggle('pm-upload-section', !isFree);

  // Prices
  setText('pm-price', '₹' + origPrice);
  setText('pm-total', isFree ? '₹0 (FREE)' : '₹' + pmFinalPrice);

  // QR
  if (!isFree) {
    updateQrCode(pmFinalPrice);
    setText('pm-upi', UPI_ID);
    const qrHint = el('pm-qr-section');
    if (qrHint) qrHint.classList.remove('hidden');
  }

  // Button + note
  const btn  = el('submit-payment-btn');
  const note = el('pm-footer-note');
  if (isFree) {
    if (btn)  btn.textContent = '✅ Get Free Access Now';
    if (note) note.textContent = 'Instant access — no payment required!';
  } else {
    if (btn)  btn.textContent = '📤 Submit Payment';
    if (note) note.textContent = 'Verification usually takes up to 20 hours.';
  }
}

function updateQrCode(amount) {
  const upiData = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&am=${amount}&cu=INR`;
  const url     = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiData)}`;
  const qr      = el('pm-qr');
  const qrFull  = el('qr-full-img');
  const qrUpi   = el('qr-full-upi');
  if (qr)    qr.src        = url;
  if (qrFull) qrFull.src   = url;
  if (qrUpi)  qrUpi.textContent = UPI_ID + ' · ₹' + amount;
}

function closePaymentModal(event) {
  if (!event || event.target === el('payment-modal')) {
    el('payment-modal').classList.add('hidden');
    pmBook = null;
  }
}

// ── QR FULLSCREEN ─────────────────────────────────────────────
function openQrFull() { el('qr-fullscreen').classList.remove('hidden'); }
function closeQrFull(event) {
  if (!event || event.target === el('qr-fullscreen'))
    el('qr-fullscreen').classList.add('hidden');
}

// ── COUPON ────────────────────────────────────────────────────
async function applyCoupon() {
  if (pmCouponCode) { showToast('Remove existing coupon first.', 'info'); return; }
  const code = el('coupon-input').value.trim().toUpperCase();
  if (!code) return;
  const btn = el('coupon-btn');
  const msg = el('coupon-msg');
  setBtn(btn, true, '…');
  try {
    const origPrice = parseFloat(pmBook?.price) || 0;
    const res = await gas('validateCoupon', { code, price: origPrice });
    pmCouponCode = code;
    pmFinalPrice = res.finalPrice;
    setText('pm-discount', '-₹' + res.discount.toFixed(2));
    setText('pm-total',    '₹'  + res.finalPrice.toFixed(2));
    el('pm-discount-row')?.classList.remove('hidden');
    if (msg) { msg.textContent = '✓ Coupon applied!'; msg.className = 'coupon-msg ok'; }
    if (pmFinalPrice <= 0) { pmFinalPrice = 0; pmIsFree = true; }
    else updateQrCode(pmFinalPrice);
    refreshPaymentModal();
    showToast('Coupon applied! ₹' + res.discount.toFixed(2) + ' off.', 'success');
  } catch (err) {
    if (msg) { msg.textContent = err.message; msg.className = 'coupon-msg'; }
  }
  setBtn(btn, false, 'Apply');
}

// ── SCREENSHOT ────────────────────────────────────────────────
function previewScreenshot(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    el('screenshot-preview').src = ev.target.result;
    el('screenshot-preview').classList.remove('hidden');
    el('upload-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

// ── PAYMENT SUBMIT ROUTER ─────────────────────────────────────
async function handlePaymentSubmit() {
  const isFree = pmIsFree || pmFinalPrice === 0;
  if (isFree) await claimFreeBook();
  else        await submitPayment();
}

// Free book / first-book-free — instant access
async function claimFreeBook() {
  if (!pmBook || !currentUser) return;
  const btn = el('submit-payment-btn');
  setBtn(btn, true, 'Getting access…');
  try {
    await gas('claimFreeBook', { email: currentUser.email, bookId: pmBook.id });
    purchases = [...purchases, pmBook.id];
    // Remove from cart if present
    cart = cart.filter(c => c.id !== pmBook.id);
    saveCart(); updateCartBadge();
    closePaymentModal();
    renderBooks(filteredBooks);
    showToast('🎉 Access granted! Read "' + pmBook.title + '" now.', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
  setBtn(btn, false, '✅ Get Free Access Now');
}

// Paid — screenshot required
async function submitPayment() {
  if (!pmBook || !currentUser) return;
  const file = el('screenshot-input').files[0];
  if (!file) { showToast('Please upload your payment screenshot.', 'error'); return; }
  const btn = el('submit-payment-btn');
  setBtn(btn, true, 'Submitting…');
  try {
    const base64 = await fileToBase64(file);
    await gas('submitPayment', {
      email: currentUser.email, bookId: pmBook.id,
      amount: pmFinalPrice, coupon: pmCouponCode, screenshotBase64: base64
    });
    // Remove from cart
    cart = cart.filter(c => c.id !== pmBook.id);
    saveCart(); updateCartBadge();
    closePaymentModal();
    showToast('Payment submitted! Verification takes up to 20 hours.', 'success');
  } catch (err) { showToast('Submission failed: ' + err.message, 'error'); }
  setBtn(btn, false, '📤 Submit Payment');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ── PDF ───────────────────────────────────────────────────────
function openPdf(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book?.pdf) { showToast('PDF not available.', 'error'); return; }
  if (!purchases.includes(bookId)) { openPaymentModal(bookId); return; }
  setText('pdf-title', book.title);
  el('pdf-frame').src = `https://docs.google.com/viewer?url=${encodeURIComponent(book.pdf)}&embedded=true`;
  el('pdf-modal').classList.remove('hidden');
}
function closePdfModal(event) {
  if (!event || event.target === el('pdf-modal')) {
    el('pdf-modal').classList.add('hidden');
    el('pdf-frame').src = '';
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser || currentUser.role === 'admin') return;
  try {
    const [purRes, payRes] = await Promise.all([
      gas('getPurchases', { email: currentUser.email }).catch(() => ({ purchases: [] })),
      gas('getPayments',  { email: currentUser.email }).catch(() => ({ payments:  [] }))
    ]);
    const purList  = Array.isArray(purRes.purchases) ? purRes.purchases : [];
    const payments = Array.isArray(payRes.payments)  ? payRes.payments  : [];
    const pending  = payments.filter(p => p.status === 'Pending');
    purchases      = purList.map(p => p.bookId);

    setText('stat-purchased', purList.length);
    setText('stat-pending',   pending.length);

    const grid  = el('my-books-grid');
    const empty = el('my-books-empty');
    if (purList.length === 0) {
      grid.innerHTML = ''; empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      grid.innerHTML = purList.map(p => {
        const book = allBooks.find(b => b.id === p.bookId);
        if (!book) return '';
        return `
          <div class="book-card" onclick="openPdf('${esc(book.id)}')">
            <div class="book-cover">
              ${book.thumbnail
                ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="book-cover-placeholder" style="display:none">📖</div>`
                : `<div class="book-cover-placeholder">📖</div>`}
              <span class="cover-badge cover-badge-free">Owned</span>
            </div>
            <div class="book-body">
              <h3 class="book-title">${esc(book.title)}</h3>
              <p class="book-desc">${esc(book.description || '')}</p>
              <div class="book-footer">
                <button class="btn btn-success w-full" onclick="openPdf('${esc(book.id)}');event.stopPropagation()">📖 Read Now</button>
              </div>
            </div>
          </div>`;
      }).join('');
    }

    const pList  = el('pending-list');
    const pEmpty = el('pending-empty');
    if (pending.length === 0) {
      pList.innerHTML = ''; pEmpty.classList.remove('hidden');
    } else {
      pEmpty.classList.add('hidden');
      pList.innerHTML = pending.map(p => {
        const book = allBooks.find(b => b.id === p.bookId);
        return `
          <div class="pending-item">
            <div class="pending-item-left">
              <strong>${esc(book?.title || p.bookId)}</strong>
              <span>₹${p.amount} · ${new Date(p.submittedAt).toLocaleDateString()}</span>
            </div>
            <span class="role-badge pending">Pending</span>
          </div>`;
      }).join('');
    }
  } catch (err) { showToast('Failed to load dashboard.', 'error'); }
}

function switchDashTab(tab, btn) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-dashboard .tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
  el('dash-tab-' + tab)?.classList.add('active');
  btn.classList.add('active');
}

// ── ADMIN ─────────────────────────────────────────────────────
async function loadAdmin() {
  if (!currentUser || currentUser.role !== 'admin' || !adminCreds) return;
  try {
    const [statsRes, payRes] = await Promise.all([
      gas('getStats',      adminCreds).catch(() => ({})),
      gas('getAllPayments', adminCreds).catch(() => ({ payments: [] }))
    ]);
    setText('a-users',   statsRes.totalUsers   || 0);
    setText('a-books',   statsRes.totalBooks   || 0);
    setText('a-sales',   statsRes.totalSales   || 0);
    setText('a-revenue', '₹' + (statsRes.totalRevenue || 0));
    setText('a-pending', statsRes.pendingVerifications || 0);

    const payList  = Array.isArray(payRes.payments) ? payRes.payments : [];
    const loading  = el('payments-loading');
    const listEl   = el('payments-list');
    const empty    = el('payments-empty');
    if (loading) loading.classList.add('hidden');

    if (payList.length === 0) {
      listEl?.classList.add('hidden');
      empty?.classList.remove('hidden');
    } else {
      empty?.classList.add('hidden');
      listEl?.classList.remove('hidden');
      listEl.innerHTML = payList.map(p => {
        const book = allBooks.find(b => b.id === p.bookId);
        const statusBadge = {
          Pending:  '<span class="role-badge pending">Pending</span>',
          Approved: '<span class="role-badge approved">Approved</span>',
          Rejected: '<span class="role-badge rejected">Rejected</span>'
        }[p.status] || esc(p.status);

        const actions = p.status === 'Pending'
          ? `<button class="btn btn-success btn-sm" onclick="adminApprove('${esc(p.id)}',this)">✅ Approve</button>
             <button class="btn btn-danger  btn-sm" onclick="adminReject('${esc(p.id)}',this)">✕ Reject</button>`
          : '';
        const screenshot = p.screenshotUrl && p.screenshotUrl !== 'upload_failed'
          ? `<a href="${esc(p.screenshotUrl)}" target="_blank" class="btn btn-ghost btn-sm">View SS</a>` : '';

        return `
          <div class="payment-card">
            <div class="payment-card-top">
              <div class="payment-card-info">
                <strong>${esc(p.userEmail)}</strong>
                <span>${esc(book?.title || p.bookId)} · ₹${p.amount}${p.coupon ? ' · Coupon: ' + esc(p.coupon) : ''}</span>
                <span>${new Date(p.submittedAt).toLocaleDateString()}</span>
              </div>
              ${statusBadge}
            </div>
            <div class="payment-card-actions">
              ${actions}${screenshot}
            </div>
          </div>`;
      }).join('');
    }
    loadCoupons();
  } catch (err) { showToast('Failed to load admin data.', 'error'); }
}

async function adminApprove(paymentId, btn) {
  if (!adminCreds) return;
  setBtn(btn, true, '…');
  try {
    await gas('approvePayment', { paymentId, ...adminCreds });
    showToast('Payment approved! Book unlocked.', 'success');
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); setBtn(btn, false, '✅ Approve'); }
}
async function adminReject(paymentId, btn) {
  if (!adminCreds) return;
  setBtn(btn, true, '…');
  try {
    await gas('rejectPayment', { paymentId, ...adminCreds });
    showToast('Payment rejected.', 'info');
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); setBtn(btn, false, '✕ Reject'); }
}

async function submitAddBook() {
  if (!adminCreds) return;
  const title = el('b-title').value.trim();
  const pdf   = el('b-pdf').value.trim();
  if (!title) { showToast('Book title is required.', 'error'); return; }
  if (!pdf)   { showToast('PDF URL is required.', 'error'); return; }
  const btn = el('add-book-btn');
  setBtn(btn, true, 'Adding…');
  try {
    await gas('addBook', {
      ...adminCreds,
      title:       title,
      description: el('b-desc').value,
      thumbnail:   el('b-thumb').value,
      pdf:         pdf,
      price:       el('b-price').value || 0,
      keywords:    el('b-keywords').value,
      type:        el('b-type').value
    });
    clearInputs(['b-title','b-desc','b-thumb','b-pdf','b-price','b-keywords']);
    el('b-type').value = 'premium';
    showToast('Book added!', 'success');
    loadBooks();
  } catch (err) { showToast(err.message, 'error'); }
  setBtn(btn, false, 'Add Book');
}

async function submitAddCoupon() {
  if (!adminCreds) return;
  const code   = el('c-code').value.toUpperCase().trim();
  const value  = el('c-value').value;
  const expiry = el('c-expiry').value;
  if (!code || !value || !expiry) { showToast('All coupon fields are required.', 'error'); return; }
  try {
    await gas('addCoupon', {
      ...adminCreds,
      code, type: el('c-type').value, value, expiry
    });
    clearInputs(['c-code','c-value','c-expiry']);
    showToast('Coupon created!', 'success');
    loadCoupons();
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadCoupons() {
  if (!adminCreds) return;
  try {
    const res     = await gas('getCoupons', adminCreds);
    const coupons = Array.isArray(res.coupons) ? res.coupons : [];
    const listEl  = el('coupons-list');
    if (coupons.length === 0) {
      listEl.innerHTML = '<p class="text-muted text-sm" style="padding:12px 0">No coupons yet.</p>';
      return;
    }
    listEl.innerHTML = coupons.map(c => `
      <div class="coupon-item">
        <span class="coupon-item-code">${esc(c.code)}</span>
        <span class="coupon-item-details">${c.type === 'percent' ? c.value + '% off' : '₹' + c.value + ' off'} · Expires ${new Date(c.expiry).toLocaleDateString()}</span>
        <span class="role-badge ${c.status === 'active' ? 'approved' : 'rejected'}">${esc(c.status)}</span>
      </div>`).join('');
  } catch {}
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-admin .tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
  el('admin-tab-' + tab)?.classList.add('active');
  btn.classList.add('active');
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toastEl = document.createElement('div');
  toastEl.className = `toast ${type}`;
  toastEl.innerHTML = `<span>${icons[type] || ''}</span><span>${esc(message)}</span>`;
  el('toast-container').appendChild(toastEl);
  setTimeout(() => toastEl.remove(), 4200);
}

// ── UTILITIES ─────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function toggle(id, show) {
  const e = el(id);
  if (!e) return;
  if (show) e.classList.remove('hidden'); else e.classList.add('hidden');
}
function getInitials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function clearInputs(ids) {
  ids.forEach(id => { const e = el(id); if (e) e.value = ''; });
}
function setBtn(btn, disabled, text) {
  if (!btn) return;
  btn.disabled    = disabled;
  btn.textContent = text;
}
