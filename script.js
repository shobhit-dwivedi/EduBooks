/* ═══════════════════════════════════════════════════════════════
   EduBooks — script.js

   HOW TO SET UP (only 2 things to fill in):
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
let purchases         = [];
let currentFilter     = 'all';

let pmBook            = null;
let pmFinalPrice      = 0;
let pmCouponCode      = '';
let pmIsFree          = false;
let pmIsFirstBookFree = false;   // true when user has 0 purchases → first book free

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('eb_theme') || 'light');

  if (!GAS_URL || GAS_URL === 'YOUR_GAS_SCRIPT_URL_HERE') {
    const banner = document.getElementById('setup-banner');
    if (banner) banner.classList.remove('hidden');
  }

  restoreSession();
  loadBooks();

  document.addEventListener('click', e => {
    const drop = document.getElementById('user-dropdown');
    const chip = document.querySelector('.user-chip');
    if (drop && !drop.classList.contains('hidden') && chip && !chip.contains(e.target))
      drop.classList.add('hidden');
    const sd = document.getElementById('search-dropdown');
    if (sd && !sd.classList.contains('hidden') &&
        !e.target.closest('.search-wrap') && !e.target.closest('.hero-search'))
      sd.classList.add('hidden');
  });
});

// ── GAS HELPER ────────────────────────────────────────────────
async function gas(action, body = {}) {
  if (!GAS_URL || GAS_URL === 'YOUR_GAS_SCRIPT_URL_HERE') {
    throw new Error('GAS_URL not set. Open script.js and paste your deployed Apps Script URL.');
  }
  const payload = JSON.stringify({ action, ...body });
  let res, text;
  try {
    res  = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ payload })
    });
    text = await res.text();
  } catch (networkErr) {
    throw new Error('Network error — check your internet connection and GAS URL.');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('GAS non-JSON response:', text.slice(0, 400));
    throw new Error('Server returned an unexpected response. Re-deploy GAS as Web App (Execute as: Me, Anyone).');
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
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

// ── SESSION ───────────────────────────────────────────────────
function restoreSession() {
  try {
    const raw = localStorage.getItem('eb_session');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && s.user && s.user.email && s.user.role) {
      setCurrentUser(s.user, s.adminCreds || null);
    } else {
      localStorage.removeItem('eb_session');
    }
  } catch {
    localStorage.removeItem('eb_session');
  }
}

function setCurrentUser(user, creds) {
  if (!user || typeof user !== 'object' || !user.email) return;
  currentUser = user;
  adminCreds  = creds || null;
  const isAdmin = (user.role === 'admin');

  toggle('auth-logged-out', false);
  toggle('auth-logged-in',  true);

  const initials = getInitials(user.name || user.username || 'U');
  setText('user-initials',   initials);
  setText('nav-username',    user.username || user.name);
  setText('drop-initials',   initials);
  setText('drop-name',       user.name || user.username);
  setText('drop-email',      user.email);
  setText('drop-role-badge', isAdmin ? 'Admin' : 'Buyer');

  const roleBadge = document.getElementById('drop-role-badge');
  if (roleBadge) roleBadge.className = 'badge ' + (isAdmin ? 'badge-admin' : 'badge-primary') + ' text-xs';

  toggle('admin-nav-link', isAdmin);
  toggle('mob-admin-link', isAdmin);
  toggle('mob-dash-link',  !isAdmin);
  toggle('mob-auth-out',   false);
  toggle('mob-signout',    true);

  const circle = document.getElementById('dash-initials-circle');
  if (circle) circle.textContent = initials;
  setText('dash-name',  user.name || user.username);
  setText('dash-email', user.email);
  const dashBadge = document.getElementById('dash-role-badge');
  if (dashBadge) {
    dashBadge.textContent = user.role;
    dashBadge.className   = 'badge ' + (isAdmin ? 'badge-admin' : 'badge-primary');
  }
  const pc = document.getElementById('profile-initials-circle');
  if (pc) pc.textContent = initials;
  setText('profile-name',     user.name || user.username);
  setText('profile-email',    user.email);
  setText('profile-username', '@' + (user.username || ''));
  setText('profile-role',     user.role || 'buyer');
}

function signOut() {
  currentUser = null;
  adminCreds  = null;
  purchases   = [];
  localStorage.removeItem('eb_session');
  toggle('auth-logged-in',  false);
  toggle('auth-logged-out', true);
  toggle('mob-auth-out',    true);
  toggle('mob-signout',     false);
  toggle('mob-dash-link',   false);
  toggle('mob-admin-link',  false);
  showPage('home');
  showToast('Signed out.', 'info');
  renderBooks(filteredBooks);
}

// ── PAGES ─────────────────────────────────────────────────────
function showPage(page) {
  if (page === 'dashboard' && !currentUser)  { openAuth('login');  return; }
  if (page === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Admin access only.', 'error'); return;
  }
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active'); p.classList.add('hidden');
  });
  const el = document.getElementById('page-' + page);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (page === 'dashboard') loadDashboard();
  if (page === 'admin')     loadAdmin();
}

function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('hidden');
}

// ── AUTH MODAL ────────────────────────────────────────────────
function openAuth(tab) {
  document.getElementById('auth-modal').classList.remove('hidden');
  switchAuthTab(tab || 'login');
}
function closeAuthModal(event) {
  if (!event || event.target === document.getElementById('auth-modal'))
    document.getElementById('auth-modal').classList.add('hidden');
}
function switchAuthTab(tab) {
  ['login', 'register', 'admin'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    document.getElementById('form-' + t).classList.toggle('hidden', t !== tab);
  });
}

// ── REGISTER ──────────────────────────────────────────────────
async function submitRegister(e) {
  e.preventDefault();
  const btn      = document.getElementById('register-btn');
  const name     = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!name || !username || !email || !password) { showToast('Please fill in all fields.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const res  = await gas('registerBuyer', { name, username, email, password });
    const user = res.user;
    if (!user || !user.email) { showToast('Registration failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    document.getElementById('auth-modal').classList.add('hidden');
    clearForm(['reg-name', 'reg-username', 'reg-email', 'reg-password']);
    showToast('Welcome, ' + (user.name || user.username) + '! Your first book is FREE 🎉', 'success');
    purchases = [];
    renderBooks(filteredBooks);
  } catch (err) { showToast(err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Create Account';
}

// ── LOGIN ─────────────────────────────────────────────────────
async function submitLogin(e) {
  e.preventDefault();
  const btn      = document.getElementById('login-btn');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { showToast('Enter your email and password.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res  = await gas('loginBuyer', { email, password });
    const user = res.user;
    if (!user || !user.email) { showToast('Login failed.', 'error'); return; }
    localStorage.setItem('eb_session', JSON.stringify({ user }));
    setCurrentUser(user, null);
    document.getElementById('auth-modal').classList.add('hidden');
    clearForm(['login-email', 'login-password']);
    purchases = await loadPurchases();
    renderBooks(filteredBooks);
    const msg = purchases.length === 0
      ? 'Welcome back! Your first book is still FREE 🎉'
      : 'Welcome back, ' + (user.name || user.username) + '!';
    showToast(msg, 'success');
  } catch (err) { showToast(err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Sign In';
}

// ── ADMIN LOGIN ───────────────────────────────────────────────
async function submitAdminLogin(e) {
  e.preventDefault();
  const btn      = document.getElementById('admin-login-btn');
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  if (!username || !password) { showToast('Enter admin credentials.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const res   = await gas('checkAdmin', { username, password });
    const user  = res.user;
    if (!user || !user.email) { showToast('Admin login failed.', 'error'); return; }
    const creds = { adminUsername: username, adminPassword: password };
    localStorage.setItem('eb_session', JSON.stringify({ user, adminCreds: creds }));
    setCurrentUser(user, creds);
    document.getElementById('auth-modal').classList.add('hidden');
    clearForm(['admin-username', 'admin-password']);
    showToast('Admin access granted.', 'success');
    showPage('admin');
  } catch (err) { showToast(err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Admin Login';
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}
function toggleUserMenu() { document.getElementById('user-dropdown').classList.toggle('hidden'); }
function closeUserMenu()   { document.getElementById('user-dropdown').classList.add('hidden');   }

// ── BOOKS ─────────────────────────────────────────────────────
async function loadBooks() {
  try {
    const res     = await gas('getBooks');
    allBooks      = Array.isArray(res.books) ? res.books : [];
    filteredBooks = [...allBooks];
    if (currentUser && currentUser.role !== 'admin') purchases = await loadPurchases();
    renderBooks(filteredBooks);
  } catch {
    document.getElementById('books-loading').classList.add('hidden');
    document.getElementById('books-empty').classList.remove('hidden');
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
  document.getElementById('books-loading').classList.add('hidden');
  const grid  = document.getElementById('books-grid');
  const empty = document.getElementById('books-empty');
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
  const kws         = book.keywords ? book.keywords.split(',').slice(0, 3) : [];

  // New user = not logged in OR has 0 purchases → eligible for first book free
  const isNewUser   = !currentUser || purchases.length === 0;
  // Show as free if: actually free book, OR user is new (first book free) and hasn't bought it yet
  const showAsFree  = isFreeBook || (isNewUser && !isPurchased);

  const thumb = book.thumbnail
    ? `<img class="book-thumb" src="${esc(book.thumbnail)}" alt="${esc(book.title)}" onerror="this.outerHTML='<div class=\\'book-thumb-placeholder\\'>📖</div>'" />`
    : `<div class="book-thumb-placeholder">📖</div>`;

  const badge = showAsFree
    ? `<span class="badge badge-free">Free</span>`
    : `<span class="badge badge-premium">Premium</span>`;

  // Price display
  let priceHtml;
  if (isFreeBook) {
    // Actual free book — always show FREE (with strikethrough MRP if it has one)
    priceHtml = price > 0
      ? `<span class="book-price-group"><s class="orig-price">₹${price}</s>&nbsp;<span class="free-tag">FREE</span></span>`
      : `<span class="free-tag">FREE</span>`;
  } else if (isNewUser && !isPurchased && price > 0) {
    // Premium book but user is new → show as first-book-free
    priceHtml = `<span class="book-price-group"><s class="orig-price">₹${price}</s>&nbsp;<span class="free-tag">FREE</span></span>`;
  } else if (isNewUser && !isPurchased) {
    priceHtml = `<span class="free-tag">FREE</span>`;
  } else {
    priceHtml = `<span class="book-price">₹${price}</span>`;
  }

  // Button
  let btn;
  if (isPurchased) {
    btn = `<button class="btn btn-success btn-sm" onclick="openPdf('${esc(book.id)}')">Read Now</button>`;
  } else if (showAsFree) {
    btn = `<button class="btn btn-primary btn-sm" onclick="openPaymentModal('${esc(book.id)}')">Get Free 🎉</button>`;
  } else {
    btn = `<button class="btn btn-primary btn-sm" onclick="openPaymentModal('${esc(book.id)}')">Buy ₹${price}</button>`;
  }

  const kwHtml = kws.map(k => `<span class="keyword-tag">${esc(k.trim())}</span>`).join('');
  return `
    <div class="book-card" style="animation-delay:${idx * 0.05}s">
      ${thumb}
      <div class="book-body">
        <div class="book-type-row">${badge}${priceHtml}</div>
        <h3 class="book-title">${esc(book.title)}</h3>
        <p class="book-desc">${esc(book.description || '')}</p>
        ${kwHtml ? `<div class="book-keywords">${kwHtml}</div>` : ''}
        <div class="book-footer">${btn}</div>
      </div>
    </div>`;
}

// ── SEARCH & FILTER ───────────────────────────────────────────
function handleSearch() {
  const nav  = document.getElementById('search-input');
  const hero = document.getElementById('hero-search');
  const q    = (document.activeElement === hero ? hero : nav)?.value?.toLowerCase() || '';
  if (nav  && document.activeElement !== nav)  nav.value  = q;
  if (hero && document.activeElement !== hero) hero.value = q;
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
  const drop = document.getElementById('search-dropdown');
  if (drop && q.length > 1 && res.length > 0) {
    drop.innerHTML = res.slice(0, 5).map(b => `
      <div class="search-item" onclick="document.getElementById('search-dropdown').classList.add('hidden')">
        ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" onerror="this.style.display='none'" />` : '<div style="width:34px;height:34px;background:var(--bg3);border-radius:6px"></div>'}
        <div><p>${esc(b.title)}</p><small>${b.type === 'free' ? 'Free' : '₹' + b.price}</small></div>
      </div>`).join('');
    drop.classList.remove('hidden');
  } else if (drop) {
    drop.classList.add('hidden');
  }
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter((document.getElementById('hero-search') || { value: '' }).value.toLowerCase());
}

// ── PAYMENT MODAL ─────────────────────────────────────────────
function openPaymentModal(bookId) {
  if (!currentUser) { showToast('Please login to continue.', 'info'); openAuth('login'); return; }
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  pmBook       = book;
  pmCouponCode = '';

  const isFreeBook      = String(book.type).toLowerCase() === 'free';
  pmIsFirstBookFree     = purchases.length === 0 && !isFreeBook; // premium book, new user
  const effectivelyFree = isFreeBook || pmIsFirstBookFree;

  pmFinalPrice = effectivelyFree ? 0 : (parseFloat(book.price) || 0);
  pmIsFree     = effectivelyFree;

  setText('pm-title', book.title);
  setText('pm-desc',  book.description || '');

  const thumb = document.getElementById('pm-thumb');
  if (thumb) {
    thumb.src          = book.thumbnail || '';
    thumb.style.display = book.thumbnail ? 'block' : 'none';
  }

  // Reset coupon UI
  const couponInput = document.getElementById('coupon-input');
  const couponMsg   = document.getElementById('coupon-msg');
  if (couponInput) couponInput.value     = '';
  if (couponMsg)   { couponMsg.textContent = ''; couponMsg.className = 'coupon-msg'; }
  document.getElementById('pm-discount-row').classList.add('hidden');

  // Reset screenshot
  const screenshotInput = document.getElementById('screenshot-input');
  if (screenshotInput) screenshotInput.value = '';
  document.getElementById('screenshot-preview').classList.add('hidden');
  document.getElementById('upload-placeholder').classList.remove('hidden');

  refreshPaymentModal();
  document.getElementById('payment-modal').classList.remove('hidden');
}

function refreshPaymentModal() {
  const isFree    = pmIsFree || pmFinalPrice === 0;
  const origPrice = parseFloat(pmBook?.price) || 0;

  // Free notice
  const notice = document.getElementById('pm-free-notice');
  if (notice) {
    if (pmIsFirstBookFree) {
      notice.innerHTML   = '🎉 <strong>First Book Free!</strong> Choose any one book on us — instant access, no payment needed.';
      notice.classList.remove('hidden');
    } else if (isFree) {
      notice.innerHTML   = '✅ <strong>This book is Free!</strong> Instant access — no payment needed.';
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }
  }

  // Show/hide payment sections
  toggle('pm-qr-section',     !isFree);
  toggle('pm-coupon-section', !isFree);
  toggle('pm-upload-section', !isFree);

  // Price breakdown
  setText('pm-price', '₹' + origPrice);
  setText('pm-total', '₹' + pmFinalPrice);

  // QR code
  if (!isFree) {
    updateQrCode(pmFinalPrice);
    setText('pm-upi', UPI_ID);
  }

  // Button & footer note
  const btn  = document.getElementById('submit-payment-btn');
  const note = document.getElementById('pm-footer-note');
  if (isFree) {
    if (btn)  btn.textContent  = '✅ Get Free Access';
    if (note) note.textContent = 'Instant access — no payment required!';
  } else {
    if (btn)  btn.textContent  = 'Submit Payment';
    if (note) note.textContent = 'Verification usually takes up to 20 hours';
  }
}

function updateQrCode(amount) {
  const upiData  = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&am=${amount}&cu=INR`;
  const url      = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiData)}`;
  const qr       = document.getElementById('pm-qr');
  const qrFull   = document.getElementById('qr-full-img');
  const qrUpiTxt = document.getElementById('qr-full-upi');
  if (qr)       qr.src           = url;
  if (qrFull)   qrFull.src       = url;
  if (qrUpiTxt) qrUpiTxt.textContent = UPI_ID + ' · ₹' + amount;
}

function closePaymentModal(event) {
  if (!event || event.target === document.getElementById('payment-modal')) {
    document.getElementById('payment-modal').classList.add('hidden');
    pmBook = null;
  }
}

// ── QR FULLSCREEN ─────────────────────────────────────────────
function openQrFull() {
  document.getElementById('qr-fullscreen').classList.remove('hidden');
}
function closeQrFull(event) {
  if (!event || event.target === document.getElementById('qr-fullscreen'))
    document.getElementById('qr-fullscreen').classList.add('hidden');
}

// ── COUPON ────────────────────────────────────────────────────
async function applyCoupon() {
  if (pmCouponCode) { showToast('Remove the current coupon first.', 'info'); return; }
  const code = document.getElementById('coupon-input').value.trim().toUpperCase();
  if (!code) return;
  const btn = document.getElementById('coupon-btn');
  const msg = document.getElementById('coupon-msg');
  btn.disabled = true; btn.textContent = '…';
  try {
    const origPrice = parseFloat(pmBook?.price) || 0;
    const res = await gas('validateCoupon', { code, price: origPrice });
    pmCouponCode = code;
    pmFinalPrice = res.finalPrice;

    setText('pm-discount', '-₹' + res.discount.toFixed(2));
    setText('pm-total',    '₹'  + res.finalPrice.toFixed(2));
    document.getElementById('pm-discount-row').classList.remove('hidden');

    if (msg) { msg.textContent = ''; msg.className = 'coupon-msg'; }

    if (pmFinalPrice <= 0) {
      pmFinalPrice = 0;
      pmIsFree     = true;
    } else {
      updateQrCode(pmFinalPrice);
    }
    refreshPaymentModal();
    showToast('Coupon applied! ₹' + res.discount.toFixed(2) + ' off.', 'success');
  } catch (err) {
    if (msg) { msg.textContent = err.message; msg.className = 'coupon-msg error'; }
  }
  btn.disabled = false; btn.textContent = 'Apply';
}

function removeCoupon() {
  pmCouponCode = '';
  pmFinalPrice = parseFloat(pmBook?.price) || 0;
  pmIsFree     = String(pmBook?.type).toLowerCase() === 'free' || pmIsFirstBookFree;
  if (!pmIsFree) pmFinalPrice = parseFloat(pmBook?.price) || 0; else pmFinalPrice = 0;

  const couponInput = document.getElementById('coupon-input');
  const couponMsg   = document.getElementById('coupon-msg');
  if (couponInput) couponInput.value     = '';
  if (couponMsg)   { couponMsg.textContent = ''; }
  document.getElementById('pm-discount-row').classList.add('hidden');
  refreshPaymentModal();
}

// ── SCREENSHOT ────────────────────────────────────────────────
function previewScreenshot(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('screenshot-preview').src = ev.target.result;
    document.getElementById('screenshot-preview').classList.remove('hidden');
    document.getElementById('upload-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

// ── PAYMENT SUBMIT ROUTER ─────────────────────────────────────
async function handlePaymentSubmit() {
  const isFree = pmIsFree || pmFinalPrice === 0;
  if (isFree) {
    await claimFreeBook();
  } else {
    await submitPayment();
  }
}

// Free book / first-book-free — instant access, no admin approval needed
async function claimFreeBook() {
  if (!pmBook || !currentUser) return;
  const btn = document.getElementById('submit-payment-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Getting access…'; }
  try {
    await gas('claimFreeBook', { email: currentUser.email, bookId: pmBook.id });
    purchases = [...purchases, pmBook.id];
    closePaymentModal();
    renderBooks(filteredBooks);
    showToast('🎉 Access granted! You can now read "' + pmBook.title + '".', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '✅ Get Free Access'; }
}

// Paid book — requires screenshot upload and admin approval
async function submitPayment() {
  if (!pmBook || !currentUser) return;
  const file = document.getElementById('screenshot-input').files[0];
  if (!file) { showToast('Please upload your payment screenshot.', 'error'); return; }
  const btn = document.getElementById('submit-payment-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const base64 = await fileToBase64(file);
    await gas('submitPayment', {
      email: currentUser.email, bookId: pmBook.id,
      amount: pmFinalPrice, coupon: pmCouponCode, screenshotBase64: base64
    });
    closePaymentModal();
    showToast('Payment submitted! Verification takes up to 20 hours.', 'success');
  } catch (err) { showToast('Submission failed: ' + err.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Submit Payment'; }
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
  if (!book || !book.pdf) { showToast('PDF not available for this book.', 'error'); return; }
  const isPurchased = purchases.includes(bookId);
  if (!isPurchased) { openPaymentModal(bookId); return; }
  setText('pdf-title', book.title);
  document.getElementById('pdf-frame').src =
    `https://docs.google.com/viewer?url=${encodeURIComponent(book.pdf)}&embedded=true`;
  document.getElementById('pdf-modal').classList.remove('hidden');
}
function closePdfModal(event) {
  if (!event || event.target === document.getElementById('pdf-modal')) {
    document.getElementById('pdf-modal').classList.add('hidden');
    document.getElementById('pdf-frame').src = '';
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser || currentUser.role === 'admin') return;
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

  const grid  = document.getElementById('my-books-grid');
  const empty = document.getElementById('my-books-empty');
  if (purList.length === 0) {
    grid.innerHTML = ''; empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    grid.innerHTML = purList.map(p => {
      const book = allBooks.find(b => b.id === p.bookId);
      if (!book) return '';
      return `
        <div class="book-card">
          ${book.thumbnail ? `<img class="book-thumb" src="${esc(book.thumbnail)}" onerror="this.style.display='none'" />` : '<div class="book-thumb-placeholder">📖</div>'}
          <div class="book-body">
            <span class="badge badge-approved">Approved</span>
            <h3 class="book-title">${esc(book.title)}</h3>
            <p class="book-desc">${esc(book.description || '')}</p>
            <div class="book-footer">
              <button class="btn btn-primary btn-sm" onclick="openPdf('${esc(book.id)}')">Read Now</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  const pList  = document.getElementById('pending-list');
  const pEmpty = document.getElementById('pending-empty');
  if (pending.length === 0) {
    pList.innerHTML = ''; pEmpty.classList.remove('hidden');
  } else {
    pEmpty.classList.add('hidden');
    pList.innerHTML = pending.map(p => {
      const book = allBooks.find(b => b.id === p.bookId);
      return `
        <div class="pending-item">
          <div style="flex:1">
            <p class="fw-600">${esc(book?.title || p.bookId)}</p>
            <p class="text-sm text-muted">₹${p.amount} · ${new Date(p.submittedAt).toLocaleDateString()}</p>
          </div>
          <span class="badge badge-pending">Pending Review</span>
        </div>`;
    }).join('');
  }
}

function switchDashTab(tab, btn) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-dashboard .tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('dash-tab-' + tab).classList.add('active');
  btn.classList.add('active');
}

// ── ADMIN ─────────────────────────────────────────────────────
async function loadAdmin() {
  if (!currentUser || currentUser.role !== 'admin' || !adminCreds) return;
  const [statsRes, payRes] = await Promise.all([
    gas('getStats',      adminCreds).catch(() => ({})),
    gas('getAllPayments', adminCreds).catch(() => ({ payments: [] }))
  ]);
  setText('a-users',   statsRes.totalUsers   || 0);
  setText('a-books',   statsRes.totalBooks   || 0);
  setText('a-sales',   statsRes.totalSales   || 0);
  setText('a-revenue', '₹' + (statsRes.totalRevenue || 0));
  setText('a-pending', statsRes.pendingVerifications || 0);

  const payList = Array.isArray(payRes.payments) ? payRes.payments : [];
  const tbody   = document.getElementById('payments-tbody');
  const loading = document.getElementById('payments-loading');
  const table   = document.getElementById('payments-table');
  const empty   = document.getElementById('payments-empty');
  if (loading) loading.classList.add('hidden');
  if (payList.length === 0) {
    if (table) table.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
  } else {
    if (empty) empty.classList.add('hidden');
    if (table) table.classList.remove('hidden');
    tbody.innerHTML = payList.map(p => {
      const book = allBooks.find(b => b.id === p.bookId);
      const statusBadge = {
        Pending:  '<span class="badge badge-pending">Pending</span>',
        Approved: '<span class="badge badge-approved">Approved</span>',
        Rejected: '<span class="badge badge-rejected">Rejected</span>'
      }[p.status] || esc(p.status);
      const actions = p.status === 'Pending'
        ? `<button class="btn btn-success btn-sm" onclick="adminApprove('${esc(p.id)}',this)">Approve</button>
           <button class="btn btn-danger btn-sm"  onclick="adminReject('${esc(p.id)}',this)">Reject</button>`
        : '—';
      const screenshot = p.screenshotUrl && p.screenshotUrl !== 'upload_failed'
        ? `<a href="${esc(p.screenshotUrl)}" target="_blank" class="btn btn-outline btn-sm">View</a>` : '—';
      return `<tr>
        <td>${esc(p.userEmail)}</td>
        <td>${esc(book?.title || p.bookId)}</td>
        <td>₹${p.amount}</td>
        <td>${esc(p.coupon || '—')}</td>
        <td>${screenshot}</td>
        <td>${statusBadge}</td>
        <td>${new Date(p.submittedAt).toLocaleDateString()}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('');
  }
  loadCoupons();
}

async function adminApprove(paymentId, btn) {
  if (!adminCreds) return;
  btn.disabled = true;
  try {
    await gas('approvePayment', { paymentId, ...adminCreds });
    showToast('Payment approved! Book unlocked for the user.', 'success');
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
}
async function adminReject(paymentId, btn) {
  if (!adminCreds) return;
  btn.disabled = true;
  try {
    await gas('rejectPayment', { paymentId, ...adminCreds });
    showToast('Payment rejected.', 'info');
    loadAdmin();
  } catch (err) { showToast(err.message, 'error'); btn.disabled = false; }
}

async function submitAddBook(e) {
  e.preventDefault();
  if (!adminCreds) return;
  const btn = document.getElementById('add-book-btn');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    await gas('addBook', {
      ...adminCreds,
      title:       document.getElementById('b-title').value,
      description: document.getElementById('b-desc').value,
      thumbnail:   document.getElementById('b-thumb').value,
      pdf:         document.getElementById('b-pdf').value,
      price:       document.getElementById('b-price').value || 0,
      keywords:    document.getElementById('b-keywords').value,
      type:        document.getElementById('b-type').value
    });
    document.getElementById('add-book-form').reset();
    showToast('Book added!', 'success');
    loadBooks();
  } catch (err) { showToast(err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Add Book';
}

async function submitAddCoupon(e) {
  e.preventDefault();
  if (!adminCreds) return;
  try {
    await gas('addCoupon', {
      ...adminCreds,
      code:   document.getElementById('c-code').value.toUpperCase(),
      type:   document.getElementById('c-type').value,
      value:  document.getElementById('c-value').value,
      expiry: document.getElementById('c-expiry').value
    });
    document.getElementById('add-coupon-form').reset();
    showToast('Coupon created!', 'success');
    loadCoupons();
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadCoupons() {
  if (!adminCreds) return;
  try {
    const res     = await gas('getCoupons', adminCreds);
    const coupons = Array.isArray(res.coupons) ? res.coupons : [];
    const tbody   = document.getElementById('coupons-tbody');
    if (coupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-lg">No coupons yet.</td></tr>';
      return;
    }
    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong>${esc(c.code)}</strong></td>
        <td>${c.type === 'percent' ? 'Percentage' : 'Fixed'}</td>
        <td>${c.type === 'percent' ? c.value + '%' : '₹' + c.value}</td>
        <td>${new Date(c.expiry).toLocaleDateString()}</td>
        <td><span class="badge ${c.status === 'active' ? 'badge-approved' : 'badge-rejected'}">${esc(c.status)}</span></td>
      </tr>`).join('');
  } catch {}
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-admin .tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-tab-' + tab).classList.add('active');
  btn.classList.add('active');
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${esc(message)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ── UTILITIES ─────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function setText(id, val)  { const el = document.getElementById(id); if (el) el.textContent = val; }
function toggle(id, show)  {
  const el = document.getElementById(id);
  if (!el) return;
  if (show) el.classList.remove('hidden'); else el.classList.add('hidden');
}
function getInitials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function clearForm(ids) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}