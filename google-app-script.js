/* =========================================================
   EduBooks — Google Apps Script Backend  (v3)
   Deploy as Web App: Execute as Me, Anyone can access

   SETUP:
   1. Paste this file into Apps Script editor
   2. Set SPREADSHEET_ID below (or leave blank to use active sheet)
   3. Run the "setup" function once — it creates all required sheets
      and deletes any old/extra sheets automatically
   4. Deploy → New deployment → Web App
      Execute as: Me | Who has access: Anyone
   ========================================================= */

var ADMIN_USERNAME = 'owner';
var ADMIN_PASSWORD = 'onwer@edubooks';
var SPREADSHEET_ID = ''; // Set your Spreadsheet ID here or leave blank to use active SS

/* ── SCHEMA ───────────────────────────────────────────────── */
var SCHEMA = {
  Users:          ['id', 'username', 'name', 'email', 'password', 'role', 'joinedAt'],
  Books:          ['id', 'title', 'description', 'thumbnail', 'previewImages', 'pdf', 'price', 'keywords', 'category', 'packageId', 'rating', 'ratingsCount', 'salesCount', 'addedAt'],
  Packages:       ['id', 'name', 'description', 'coverImage', 'price', 'discountedPrice', 'active', 'createdAt'],
  Payments:       ['id', 'userEmail', 'bookIds', 'packageId', 'totalAmount', 'coupon', 'discount', 'screenshotUrl', 'status', 'submittedAt'],
  Coupons:        ['code', 'type', 'value', 'expiry', 'maxUses', 'status', 'usageCount', 'scope', 'scopeId'],
  Purchases:      ['userEmail', 'bookId', 'purchasedAt'],
  Ratings:        ['userEmail', 'bookId', 'rating', 'ratedAt'],
  SupportTickets: ['id', 'userEmail', 'userName', 'category', 'message', 'screenshotUrl', 'status', 'createdAt', 'adminReply', 'resolvedAt']
};

/* ── SETUP ─────────────────────────────────────────────────
   Run this function once from the Apps Script editor.
   It will:
     • Delete any sheets whose names are NOT in SCHEMA above
       (removes stale default "Sheet1" and any old sheets)
     • Create / repair every sheet listed in SCHEMA with
       the correct headers in bold
   ─────────────────────────────────────────────────────── */
function setup() {
  var ss          = ss_();
  var schemaNames = Object.keys(SCHEMA);

  // Delete sheets not in schema (iterate in reverse to keep indices stable)
  var allSheets = ss.getSheets();
  for (var i = allSheets.length - 1; i >= 0; i--) {
    var sh = allSheets[i];
    if (schemaNames.indexOf(sh.getName()) === -1) {
      // Google Sheets requires at least one sheet — skip only when it's the last
      if (ss.getSheets().length > 1) {
        ss.deleteSheet(sh);
      }
    }
  }

  // Create / repair every schema sheet
  schemaNames.forEach(function(name) {
    ensureSheet_(name);
  });

  Logger.log('EduBooks setup complete. Sheets: ' + schemaNames.join(', '));
}

/* ── ENTRY POINT ──────────────────────────────────────────── */
function doPost(e) {
  var resp = { success: false, error: 'Unknown error.' };
  try {
    // IMPORTANT: GAS 302-redirects strip the raw POST body.
    // The frontend sends JSON as URLSearchParams({ payload: '<json>' })
    // so we read e.parameter.payload first, then fall back to raw JSON.
    var raw = (e.parameter && e.parameter.payload)
      ? e.parameter.payload
      : (e.postData && e.postData.contents ? e.postData.contents : '{}');
    var body   = JSON.parse(raw);
    var action = body.action;
    if (!action || !ACTIONS[action]) throw new Error('Invalid action: ' + action);
    resp = ACTIONS[action](body) || {};
    if (resp.success === undefined) resp.success = true;
  } catch (err) {
    resp = { success: false, error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(resp))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── HELPERS ──────────────────────────────────────────────── */
function ss_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function ensureSheet_(name) {
  var ss      = ss_();
  var sh      = ss.getSheetByName(name);
  var headers = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return sh;
  }
  // Ensure headers match; repair if not
  var existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var match = headers.every(function(h, i) { return existingHeaders[i] === h; });
  if (!match) {
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function getRows_(name) {
  var sh   = ensureSheet_(name);
  var data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i] === undefined ? '' : row[i]; });
    return obj;
  });
}

function appendRow_(name, obj) {
  var sh      = ensureSheet_(name);
  var headers = SCHEMA[name];
  var row     = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

function adminCheck_(b) {
  return String(b.adminUsername || '').toLowerCase() === ADMIN_USERNAME.toLowerCase() &&
         String(b.adminPassword || '') === ADMIN_PASSWORD;
}

function uploadImageToDrive_(base64Data, folderName, fileName) {
  if (!base64Data || base64Data.length < 100) return '';
  try {
    var raw    = base64Data.replace(/^data:image\/\w+;base64,/, '');
    var blob   = Utilities.newBlob(Utilities.base64Decode(raw), 'image/jpeg', fileName);
    var folders = DriveApp.getFoldersByName(folderName);
    var folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) { return 'upload_failed'; }
}

/* ── ACTIONS ──────────────────────────────────────────────── */
var ACTIONS = {

  /* ── AUTH ────────────────────────────────────────────────── */
  registerBuyer: function(b) {
    var username = String(b.username || '').trim().toLowerCase();
    var name     = String(b.name     || '').trim();
    var email    = String(b.email    || '').trim().toLowerCase();
    var password = String(b.password || '').trim();

    if (!username || !name || !email || !password)
      return { success: false, error: 'All fields are required.' };
    if (username.length < 3)
      return { success: false, error: 'Username must be at least 3 characters.' };
    if (password.length < 6)
      return { success: false, error: 'Password must be at least 6 characters.' };

    var users = getRows_('Users');
    if (users.find(function(u) { return u.username === username; }))
      return { success: false, error: 'Username already taken.' };
    if (users.find(function(u) { return String(u.email).toLowerCase() === email; }))
      return { success: false, error: 'An account with this email already exists.' };

    appendRow_('Users', {
      id: uid_(), username: username, name: name,
      email: email, password: password, role: 'buyer', joinedAt: new Date().toISOString()
    });
    return { success: true };
  },

  checkAdmin: function(b) {
    var username = String(b.username || '').trim().toLowerCase();
    var password = String(b.password || '').trim();
    if (username !== ADMIN_USERNAME.toLowerCase() || password !== ADMIN_PASSWORD)
      return { success: false, error: 'Invalid admin credentials.' };
    return {
      success: true,
      user: { id: 'admin', username: ADMIN_USERNAME, name: 'Admin', email: 'admin@edubooks.local', role: 'admin' }
    };
  },

  loginBuyer: function(b) {
    var username = String(b.username || '').trim().toLowerCase();
    var password = String(b.password || '').trim();

    if (!username || !password)
      return { success: false, error: 'Username and password are required.' };

    var users = getRows_('Users');
    var user  = users.find(function(u) {
      return String(u.username).toLowerCase() === username;
    });
    if (!user)
      return { success: false, error: 'Invalid username or password.' };
    if (String(user.password) !== password)
      return { success: false, error: 'Invalid username or password.' };

    return {
      success: true,
      user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role }
    };
  },

  /* ── BOOKS ───────────────────────────────────────────────── */
  getBooks: function() {
    return {
      books: getRows_('Books').map(function(b) {
        return {
          id: b.id, title: b.title, description: b.description,
          thumbnail: b.thumbnail, previewImages: b.previewImages, pdf: b.pdf,
          price: b.price, keywords: b.keywords, category: b.category,
          packageId: b.packageId, rating: b.rating, ratingsCount: b.ratingsCount,
          salesCount: b.salesCount, addedAt: b.addedAt
        };
      })
    };
  },

  addBook: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    if (!b.title || !b.pdf)  return { success: false, error: 'Title and PDF URL are required.' };
    if (!b.price || parseFloat(b.price) <= 0) return { success: false, error: 'Valid price required.' };

    appendRow_('Books', {
      id:            uid_(),
      title:         String(b.title).trim(),
      description:   String(b.description  || '').trim(),
      thumbnail:     String(b.thumbnail    || '').trim(),
      previewImages: String(b.previewImages || '').trim(),
      pdf:           String(b.pdf).trim(),
      price:         parseFloat(b.price),
      keywords:      String(b.keywords || '').trim(),
      category:      String(b.category || 'Other').trim(),
      packageId:     String(b.packageId || '').trim(),
      rating:        parseFloat(b.rating) || 0,
      ratingsCount:  0,
      salesCount:    0,
      addedAt:       new Date().toISOString()
    });
    return { success: true };
  },

  deleteBook: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ensureSheet_('Books');
    var rows    = sh.getDataRange().getValues();
    var idCol   = rows[0].indexOf('id');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.bookId) {
        sh.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Book not found.' };
  },

  /* ── PACKAGES ────────────────────────────────────────────── */
  getPackages: function() {
    var packages = getRows_('Packages').filter(function(p) { return p.active !== false && p.active !== 'false'; });
    var books    = getRows_('Books');
    return {
      packages: packages.map(function(pkg) {
        var pkgBooks = books.filter(function(b) { return String(b.packageId) === String(pkg.id); });
        return {
          id: pkg.id, name: pkg.name, description: pkg.description,
          coverImage: pkg.coverImage, price: pkg.price,
          discountedPrice: pkg.discountedPrice, active: pkg.active,
          createdAt: pkg.createdAt, bookCount: pkgBooks.length
        };
      })
    };
  },

  getAllPackages: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    var packages = getRows_('Packages');
    var books    = getRows_('Books');
    return {
      packages: packages.map(function(pkg) {
        var pkgBooks = books.filter(function(bk) { return String(bk.packageId) === String(pkg.id); });
        return {
          id: pkg.id, name: pkg.name, description: pkg.description,
          coverImage: pkg.coverImage, price: pkg.price,
          discountedPrice: pkg.discountedPrice, active: pkg.active,
          createdAt: pkg.createdAt, bookCount: pkgBooks.length
        };
      })
    };
  },

  addPackage: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    if (!b.name) return { success: false, error: 'Package name is required.' };

    appendRow_('Packages', {
      id:              uid_(),
      name:            String(b.name).trim(),
      description:     String(b.description     || '').trim(),
      coverImage:      String(b.coverImage       || '').trim(),
      price:           parseFloat(b.price)           || 0,
      discountedPrice: parseFloat(b.discountedPrice) || 0,
      active:          true,
      createdAt:       new Date().toISOString()
    });
    return { success: true };
  },

  deletePackage: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh    = ensureSheet_('Packages');
    var rows  = sh.getDataRange().getValues();
    var idCol = rows[0].indexOf('id');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.packageId) {
        sh.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Package not found.' };
  },

  /* ── COUPONS ─────────────────────────────────────────────── */
  getCoupons: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    return { coupons: getRows_('Coupons') };
  },

  addCoupon: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var code  = String(b.code  || '').toUpperCase().trim();
    var type  = String(b.type  || 'percent');
    var value = parseFloat(b.value);
    var scope = String(b.scope || 'all');

    if (!code || isNaN(value) || value <= 0)
      return { success: false, error: 'Code and value are required.' };
    if (type === 'percent' && value > 100)
      return { success: false, error: 'Percentage cannot exceed 100.' };

    var existing = getRows_('Coupons');
    if (existing.find(function(c) { return String(c.code).toUpperCase() === code; }))
      return { success: false, error: 'Coupon code already exists.' };

    appendRow_('Coupons', {
      code:       code,
      type:       type,
      value:      value,
      expiry:     String(b.expiry  || ''),
      maxUses:    parseInt(b.maxUses) || 0,
      status:     'active',
      usageCount: 0,
      scope:      scope,
      scopeId:    String(b.scopeId || '')
    });
    return { success: true };
  },

  validateCoupon: function(b) {
    var code      = String(b.code || '').toUpperCase().trim();
    var cartIds   = b.cartBookIds ? String(b.cartBookIds).split(',').map(function(s) { return s.trim(); }) : [];
    var cartPkgId = String(b.cartPackageId || '');
    var today     = new Date();

    var coupons = getRows_('Coupons');
    var coupon  = coupons.find(function(c) { return String(c.code).toUpperCase() === code; });

    if (!coupon)                    return { success: false, error: 'Invalid coupon code.' };
    if (coupon.status !== 'active') return { success: false, error: 'This coupon is no longer active.' };
    if (coupon.expiry) {
      var exp = new Date(coupon.expiry);
      if (!isNaN(exp.getTime()) && today > exp)
        return { success: false, error: 'This coupon has expired.' };
    }
    var maxUses = parseInt(coupon.maxUses) || 0;
    if (maxUses > 0 && (parseInt(coupon.usageCount) || 0) >= maxUses)
      return { success: false, error: 'This coupon has reached its usage limit.' };

    var scope = String(coupon.scope || 'all');
    if (scope === 'book') {
      if (!cartIds.length || !cartIds.includes(String(coupon.scopeId)))
        return { success: false, error: 'This coupon is only valid for a specific book not in your cart.' };
    } else if (scope === 'package') {
      if (!cartPkgId || cartPkgId !== String(coupon.scopeId))
        return { success: false, error: 'This coupon is only valid for a specific package.' };
    }

    return { success: true, coupon: { code: coupon.code, type: coupon.type, value: parseFloat(coupon.value) } };
  },

  deleteCoupon: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ensureSheet_('Coupons');
    var rows    = sh.getDataRange().getValues();
    var codeCol = rows[0].indexOf('code');

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][codeCol]).toUpperCase() === String(b.code).toUpperCase()) {
        sh.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Coupon not found.' };
  },

  /* ── PURCHASES ───────────────────────────────────────────── */
  getPurchases: function(b) {
    var email = String(b.email || '').toLowerCase();
    return {
      purchases: getRows_('Purchases').filter(function(p) {
        return String(p.userEmail).toLowerCase() === email;
      })
    };
  },

  /* ── PAYMENTS ────────────────────────────────────────────── */
  getPayments: function(b) {
    var email = String(b.email || '').toLowerCase();
    return {
      payments: getRows_('Payments').filter(function(p) {
        return String(p.userEmail).toLowerCase() === email;
      })
    };
  },

  getAllPayments: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    var payments = getRows_('Payments');
    var books    = getRows_('Books');
    var users    = getRows_('Users');
    return { payments: payments, books: books, users: users };
  },

  submitPayment: function(b) {
    var screenshotUrl = uploadImageToDrive_(
      b.screenshotBase64 || '', 'EduBooks Payments', 'pay_' + Date.now() + '.jpg'
    );

    var bookIds = b.bookIds || b.bookId || '';
    if (Array.isArray(bookIds)) bookIds = bookIds.join(',');

    var payId = uid_();
    appendRow_('Payments', {
      id:            payId,
      userEmail:     String(b.email || '').toLowerCase(),
      bookIds:       String(bookIds),
      packageId:     String(b.packageId || ''),
      totalAmount:   b.totalAmount || b.amount || 0,
      coupon:        b.coupon   || '',
      discount:      b.discount || 0,
      screenshotUrl: screenshotUrl || '',
      status:        'Pending',
      submittedAt:   new Date().toISOString()
    });

    if (b.coupon) {
      var sh      = ss_().getSheetByName('Coupons');
      var rows    = sh.getDataRange().getValues();
      var headers = rows[0];
      var codeCol = headers.indexOf('code');
      var ucCol   = headers.indexOf('usageCount');
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][codeCol]).toUpperCase() === String(b.coupon).toUpperCase()) {
          sh.getRange(i + 1, ucCol + 1).setValue((parseInt(rows[i][ucCol]) || 0) + 1);
          break;
        }
      }
    }

    return { paymentId: payId };
  },

  approvePayment: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ensureSheet_('Payments');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var idCol   = headers.indexOf('id');
    var stCol   = headers.indexOf('status');
    var emCol   = headers.indexOf('userEmail');
    var bkCol   = headers.indexOf('bookIds');
    var userEmail = '', bookIdsStr = '';

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.paymentId) {
        sh.getRange(i + 1, stCol + 1).setValue('Approved');
        userEmail  = rows[i][emCol];
        bookIdsStr = rows[i][bkCol];
        break;
      }
    }
    if (!userEmail) return { success: false, error: 'Payment not found.' };

    var bookIds = String(bookIdsStr).split(',');
    bookIds.forEach(function(bookId) {
      var bid = bookId.trim();
      if (bid) appendRow_('Purchases', { userEmail: userEmail, bookId: bid, purchasedAt: new Date().toISOString() });
    });

    var bookSh   = ensureSheet_('Books');
    var bRows    = bookSh.getDataRange().getValues();
    var bHeaders = bRows[0];
    var bIdCol   = bHeaders.indexOf('id');
    var bScCol   = bHeaders.indexOf('salesCount');
    bookIds.forEach(function(bookId) {
      var bid = bookId.trim();
      for (var j = 1; j < bRows.length; j++) {
        if (bRows[j][bIdCol] === bid) {
          bookSh.getRange(j + 1, bScCol + 1).setValue((parseInt(bRows[j][bScCol]) || 0) + 1);
          break;
        }
      }
    });

    return { success: true };
  },

  rejectPayment: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ensureSheet_('Payments');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var idCol   = headers.indexOf('id');
    var stCol   = headers.indexOf('status');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.paymentId) {
        sh.getRange(i + 1, stCol + 1).setValue('Rejected');
        return { success: true };
      }
    }
    return { success: false, error: 'Payment not found.' };
  },

  /* ── RATINGS ─────────────────────────────────────────────── */
  rateBook: function(b) {
    var email  = String(b.email  || '').toLowerCase();
    var bookId = String(b.bookId || '');
    var rating = parseInt(b.rating) || 0;

    if (!email || !bookId || rating < 1 || rating > 5)
      return { success: false, error: 'Invalid rating data.' };

    var purchases = getRows_('Purchases');
    var owns = purchases.find(function(p) {
      return String(p.userEmail).toLowerCase() === email && p.bookId === bookId;
    });
    if (!owns) return { success: false, error: 'You must own this book to rate it.' };

    var ratings  = getRows_('Ratings');
    var existing = ratings.find(function(r) {
      return String(r.userEmail).toLowerCase() === email && r.bookId === bookId;
    });
    if (existing) return { success: false, error: 'You have already rated this book.' };

    appendRow_('Ratings', { userEmail: email, bookId: bookId, rating: rating, ratedAt: new Date().toISOString() });

    var bookSh   = ensureSheet_('Books');
    var bRows    = bookSh.getDataRange().getValues();
    var bHeaders = bRows[0];
    var bIdCol   = bHeaders.indexOf('id');
    var bRatCol  = bHeaders.indexOf('rating');
    var bRCntCol = bHeaders.indexOf('ratingsCount');

    for (var j = 1; j < bRows.length; j++) {
      if (bRows[j][bIdCol] === bookId) {
        var oldRating = parseFloat(bRows[j][bRatCol]) || 0;
        var oldCount  = parseInt(bRows[j][bRCntCol])  || 0;
        var newCount  = oldCount + 1;
        var newRating = ((oldRating * oldCount) + rating) / newCount;
        bookSh.getRange(j + 1, bRatCol  + 1).setValue(newRating.toFixed(1));
        bookSh.getRange(j + 1, bRCntCol + 1).setValue(newCount);
        break;
      }
    }
    return { success: true };
  },

  /* ── SUPPORT TICKETS ─────────────────────────────────────── */
  submitTicket: function(b) {
    var email    = String(b.email    || '').toLowerCase();
    var userName = String(b.userName || '').trim();
    var category = String(b.category || 'General').trim();
    var message  = String(b.message  || '').trim();

    if (!email || !message)
      return { success: false, error: 'Email and message are required.' };

    var screenshotUrl = '';
    if (b.screenshotBase64) {
      screenshotUrl = uploadImageToDrive_(
        b.screenshotBase64, 'EduBooks Support', 'ticket_' + Date.now() + '.jpg'
      );
    }

    appendRow_('SupportTickets', {
      id:            uid_(),
      userEmail:     email,
      userName:      userName,
      category:      category,
      message:       message,
      screenshotUrl: screenshotUrl,
      status:        'Open',
      createdAt:     new Date().toISOString(),
      adminReply:    '',
      resolvedAt:    ''
    });
    return { success: true };
  },

  getMyTickets: function(b) {
    var email = String(b.email || '').toLowerCase();
    return {
      tickets: getRows_('SupportTickets').filter(function(t) {
        return String(t.userEmail).toLowerCase() === email;
      }).sort(function(a, b_) { return new Date(b_.createdAt) - new Date(a.createdAt); })
    };
  },

  getAllTickets: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    return {
      tickets: getRows_('SupportTickets').sort(function(a, b_) {
        return new Date(b_.createdAt) - new Date(a.createdAt);
      })
    };
  },

  replyTicket: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ensureSheet_('SupportTickets');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var idCol   = headers.indexOf('id');
    var stCol   = headers.indexOf('status');
    var rpCol   = headers.indexOf('adminReply');
    var rsCol   = headers.indexOf('resolvedAt');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.ticketId) {
        var newStatus = String(b.status || 'Open');
        sh.getRange(i + 1, rpCol + 1).setValue(String(b.reply || ''));
        sh.getRange(i + 1, stCol + 1).setValue(newStatus);
        if (newStatus === 'Resolved') {
          sh.getRange(i + 1, rsCol + 1).setValue(new Date().toISOString());
        }
        return { success: true };
      }
    }
    return { success: false, error: 'Ticket not found.' };
  },

  /* ── ANALYTICS ───────────────────────────────────────────── */
  getAnalytics: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var users    = getRows_('Users');
    var books    = getRows_('Books');
    var packages = getRows_('Packages');
    var payments = getRows_('Payments');
    var purch    = getRows_('Purchases');
    var tickets  = getRows_('SupportTickets');

    var approved = payments.filter(function(p) { return p.status === 'Approved'; });
    var pending  = payments.filter(function(p) { return p.status === 'Pending';  });
    var revenue  = approved.reduce(function(sum, p) { return sum + (parseFloat(p.totalAmount) || 0); }, 0);
    var openTix  = tickets.filter(function(t)  { return t.status !== 'Resolved'; });

    return {
      totalUsers:    users.length,
      totalBooks:    books.length,
      totalPackages: packages.length,
      totalSales:    purch.length,
      totalRevenue:  revenue,
      pendingCount:  pending.length,
      approvedCount: approved.length,
      openTickets:   openTix.length
    };
  },

  getAllUsers: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    return {
      users: getRows_('Users').map(function(u) {
        return { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, joinedAt: u.joinedAt };
      })
    };
  }
};
