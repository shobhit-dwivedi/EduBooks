/* =====================================================================
   EduBooks — Google Apps Script Backend (v2 — All Paid)
   ---------------------------------------------------------------------
   SETUP (one time only):
   1. Open your Google Sheet → Extensions → Apps Script.
   2. Paste this entire file. No other configuration needed.
   3. Click Run → "setup" once to create all sheets with headers.
   4. Deploy → New deployment → Web App
      • Execute as: Me
      • Who has access: Anyone
   5. Copy the Web App URL → paste into script.js as GAS_URL.

   ADMIN LOGIN:
     Username: admin
     Password: admin123  ← change before going live

   NOTES:
   - All books are paid. There is no free book system.
   - Cart checkouts submit one payment record covering multiple books.
   - Coupon codes are validated server-side at checkout.
   ===================================================================== */

var SCHEMA = {
  Users:     ['id', 'username', 'name', 'email', 'password', 'role', 'joinedAt'],
  Books:     ['id', 'title', 'description', 'thumbnail', 'pdf', 'price', 'keywords', 'category', 'rating', 'ratingsCount', 'salesCount', 'addedAt'],
  Payments:  ['id', 'userEmail', 'bookIds', 'totalAmount', 'coupon', 'discount', 'screenshotUrl', 'status', 'submittedAt'],
  Coupons:   ['code', 'type', 'value', 'expiry', 'status', 'usageCount'],
  Purchases: ['id', 'userEmail', 'bookId', 'approvedAt'],
  Ratings:   ['userEmail', 'bookId', 'rating', 'ratedAt']
};

var ADMIN_USERNAME = 'admin';
var ADMIN_PASSWORD = 'admin123';
var ADMIN_EMAIL    = 'admin@edubooks.com';

var CATEGORIES = ['Class 9', 'Class 10', 'Class 11', 'Class 12', 'JEE', 'NEET', 'Other'];

/* ============================================================
   ENTRY POINTS
   ============================================================ */
function doPost(e) { return handle(e); }

function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOut({ success: true, message: 'EduBooks API v2 is running.' });
  }
  return handle(e);
}

function handle(e) {
  try {
    ensureAllSheets_();
    var body = {};
    if (e && e.parameter && e.parameter.payload) {
      try { body = JSON.parse(e.parameter.payload); } catch (_) { body = {}; }
    } else if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (_) { body = {}; }
    } else if (e && e.parameter) {
      body = e.parameter;
    }

    var action = String(body.action || '').trim();
    if (!action) return jsonOut({ success: false, error: 'Missing action.' });

    var fn = ACTIONS[action];
    if (!fn) return jsonOut({ success: false, error: 'Unknown action: ' + action });

    var result = fn(body) || {};
    if (result.success === false) return jsonOut(result);
    return jsonOut(Object.assign({ success: true }, result));
  } catch (err) {
    return jsonOut({ success: false, error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   SHEET HELPERS
   ============================================================ */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureAllSheets_() {
  var s = ss_();
  Object.keys(SCHEMA).forEach(function(name) {
    ensureSheet_(s, name, SCHEMA[name]);
  });
  var def = s.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && s.getSheets().length > 1) {
    s.deleteSheet(def);
  }
}

function setup() {
  ensureAllSheets_();
  SpreadsheetApp.getUi().alert('All sheets created!');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var firstRow = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  var hasAll   = headers.every(function(h, i) { return firstRow[i] === h; });
  if (!hasAll) {
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1a1a2e')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);
  }
  return sh;
}

function getRows_(sheetName) {
  var sh = ss_().getSheetByName(sheetName);
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var headers = SCHEMA[sheetName];
  var values  = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      var v = row[i];
      obj[h] = (v instanceof Date)
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss")
        : v;
    });
    return obj;
  });
}

function appendRow_(sheetName, obj) {
  var sh      = ss_().getSheetByName(sheetName);
  var headers = SCHEMA[sheetName];
  var row = headers.map(function(h) {
    if (h === 'id'          && !obj.id)          return uid_();
    if (h === 'joinedAt'    && !obj.joinedAt)    return now_();
    if (h === 'addedAt'     && !obj.addedAt)     return now_();
    if (h === 'submittedAt' && !obj.submittedAt) return now_();
    if (h === 'approvedAt'  && !obj.approvedAt)  return now_();
    if (h === 'ratedAt'     && !obj.ratedAt)     return now_();
    var v = obj[h] !== undefined ? obj[h] : '';
    return (v === null || v === undefined) ? '' : String(v);
  });
  var targetRow = sh.getLastRow() + 1;
  sh.getRange(targetRow, 1, 1, headers.length).setValues([row]);
}

function uid_() { return Utilities.getUuid().slice(0, 12); }
function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function adminCheck_(b) {
  return b.adminUsername === ADMIN_USERNAME && b.adminPassword === ADMIN_PASSWORD;
}

/* ============================================================
   ACTION HANDLERS
   ============================================================ */
var ACTIONS = {

  /* ── AUTH ── */

  registerBuyer: function(b) {
    var username = String(b.username || '').trim();
    var name     = String(b.name     || '').trim();
    var email    = String(b.email    || '').trim().toLowerCase();
    var password = String(b.password || '');

    if (!username || !name || !email || !password)
      return { success: false, error: 'All fields are required.' };
    if (password.length < 6)
      return { success: false, error: 'Password must be at least 6 characters.' };

    var users = getRows_('Users');
    if (users.find(function(u) { return String(u.email).toLowerCase() === email; }))
      return { success: false, error: 'Email already registered. Please login.' };
    if (users.find(function(u) { return String(u.username).toLowerCase() === username.toLowerCase(); }))
      return { success: false, error: 'Username already taken.' };

    appendRow_('Users', { username: username, name: name, email: email, password: password, role: 'buyer' });
    return { user: { username: username, name: name, email: email, role: 'buyer' } };
  },

  loginBuyer: function(b) {
    var email    = String(b.email    || '').trim().toLowerCase();
    var password = String(b.password || '');
    if (!email || !password) return { success: false, error: 'Email and password are required.' };

    var user = getRows_('Users').find(function(u) {
      return String(u.email).toLowerCase() === email &&
             String(u.password) === password &&
             u.role !== 'admin';
    });
    if (!user) return { success: false, error: 'Incorrect email or password.' };
    return { user: { username: user.username, name: user.name, email: user.email, role: user.role } };
  },

  checkAdmin: function(b) {
    if (adminCheck_(b) || (b.username === ADMIN_USERNAME && b.password === ADMIN_PASSWORD)) {
      return { user: { username: ADMIN_USERNAME, name: 'Admin', email: ADMIN_EMAIL, role: 'admin' } };
    }
    return { success: false, error: 'Invalid admin credentials.' };
  },

  /* ── BOOKS ── */

  getBooks: function(b) {
    var books = getRows_('Books');
    return { books: books };
  },

  addBook: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    if (!b.title || !b.pdf)  return { success: false, error: 'Title and PDF URL are required.' };

    var bookId = uid_();
    appendRow_('Books', {
      id:           bookId,
      title:        b.title       || '',
      description:  b.description || '',
      thumbnail:    b.thumbnail   || '',
      pdf:          b.pdf         || '',
      price:        parseFloat(b.price) || 0,
      keywords:     b.keywords    || '',
      category:     b.category    || 'Other',
      rating:       parseFloat(b.rating) || 0,
      ratingsCount: 0,
      salesCount:   0
    });
    return { bookId: bookId };
  },

  deleteBook: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    var sh      = ss_().getSheetByName('Books');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var idCol   = headers.indexOf('id');
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i][idCol] === b.bookId) {
        sh.deleteRow(i + 1);
        return {};
      }
    }
    return { success: false, error: 'Book not found.' };
  },

  /* ── COUPONS ── */

  getCoupons: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    return { coupons: getRows_('Coupons') };
  },

  addCoupon: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    if (!b.code || !b.value || !b.expiry) return { success: false, error: 'Code, value and expiry are required.' };

    var existing = getRows_('Coupons');
    if (existing.find(function(c) { return String(c.code).toUpperCase() === String(b.code).toUpperCase(); }))
      return { success: false, error: 'Coupon code already exists.' };

    appendRow_('Coupons', {
      code:       String(b.code).toUpperCase(),
      type:       b.type  || 'percent',
      value:      parseFloat(b.value) || 0,
      expiry:     b.expiry,
      status:     'active',
      usageCount: 0
    });
    return {};
  },

  deleteCoupon: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    var sh      = ss_().getSheetByName('Coupons');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var codeCol = headers.indexOf('code');
    for (var i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][codeCol]).toUpperCase() === String(b.code).toUpperCase()) {
        sh.deleteRow(i + 1);
        return {};
      }
    }
    return { success: false, error: 'Coupon not found.' };
  },

  validateCoupon: function(b) {
    var code = String(b.code || '').toUpperCase().trim();
    if (!code) return { success: false, error: 'No coupon code provided.' };

    var coupons = getRows_('Coupons');
    var coupon  = coupons.find(function(c) { return String(c.code).toUpperCase() === code; });

    if (!coupon)            return { success: false, error: 'Invalid coupon code.' };
    if (coupon.status !== 'active') return { success: false, error: 'Coupon is inactive.' };

    var expiry = new Date(coupon.expiry);
    if (!isNaN(expiry.getTime()) && expiry < new Date())
      return { success: false, error: 'Coupon has expired.' };

    return { coupon: { code: coupon.code, type: coupon.type, value: parseFloat(coupon.value) || 0 } };
  },

  /* ── PURCHASES & PAYMENTS ── */

  getPurchases: function(b) {
    var email = String(b.email || '').toLowerCase();
    return {
      purchases: getRows_('Purchases').filter(function(p) {
        return String(p.userEmail).toLowerCase() === email;
      })
    };
  },

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

  getAllUsers: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };
    return {
      users: getRows_('Users').map(function(u) {
        return { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, joinedAt: u.joinedAt };
      })
    };
  },

  submitPayment: function(b) {
    var screenshotUrl = '';
    if (b.screenshotBase64 && b.screenshotBase64.length > 100) {
      try {
        var raw    = b.screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
        var blob   = Utilities.newBlob(Utilities.base64Decode(raw), 'image/jpeg', 'pay_' + Date.now() + '.jpg');
        var folders = DriveApp.getFoldersByName('EduBooks Payments');
        var folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder('EduBooks Payments');
        var file    = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        screenshotUrl = file.getUrl();
      } catch (e) { screenshotUrl = 'upload_failed'; }
    }

    // bookIds can be a comma-separated string or JSON array
    var bookIds = b.bookIds || b.bookId || '';
    if (Array.isArray(bookIds)) bookIds = bookIds.join(',');

    var payId = uid_();
    appendRow_('Payments', {
      id:            payId,
      userEmail:     String(b.email || '').toLowerCase(),
      bookIds:       String(bookIds),
      totalAmount:   b.totalAmount || b.amount || 0,
      coupon:        b.coupon  || '',
      discount:      b.discount || 0,
      screenshotUrl: screenshotUrl,
      status:        'Pending'
    });

    // Increment coupon usage if used
    if (b.coupon) {
      var sh      = ss_().getSheetByName('Coupons');
      var rows    = sh.getDataRange().getValues();
      var headers = rows[0];
      var codeCol = headers.indexOf('code');
      var ucCol   = headers.indexOf('usageCount');
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][codeCol]).toUpperCase() === String(b.coupon).toUpperCase()) {
          var current = parseInt(rows[i][ucCol]) || 0;
          sh.getRange(i + 1, ucCol + 1).setValue(current + 1);
          break;
        }
      }
    }

    return { paymentId: payId };
  },

  approvePayment: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ss_().getSheetByName('Payments');
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

    // Create a purchase entry for each book
    var bookIds = String(bookIdsStr).split(',');
    bookIds.forEach(function(bookId) {
      var bid = bookId.trim();
      if (bid) appendRow_('Purchases', { userEmail: userEmail, bookId: bid });
    });

    // Increment salesCount for each book
    var bookSh  = ss_().getSheetByName('Books');
    var bRows   = bookSh.getDataRange().getValues();
    var bHeaders = bRows[0];
    var bIdCol   = bHeaders.indexOf('id');
    var bScCol   = bHeaders.indexOf('salesCount');
    bookIds.forEach(function(bookId) {
      var bid = bookId.trim();
      for (var j = 1; j < bRows.length; j++) {
        if (bRows[j][bIdCol] === bid) {
          var sc = parseInt(bRows[j][bScCol]) || 0;
          bookSh.getRange(j + 1, bScCol + 1).setValue(sc + 1);
          break;
        }
      }
    });

    return {};
  },

  rejectPayment: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var sh      = ss_().getSheetByName('Payments');
    var rows    = sh.getDataRange().getValues();
    var headers = rows[0];
    var idCol   = headers.indexOf('id');
    var stCol   = headers.indexOf('status');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === b.paymentId) {
        sh.getRange(i + 1, stCol + 1).setValue('Rejected');
        return {};
      }
    }
    return { success: false, error: 'Payment not found.' };
  },

  rateBook: function(b) {
    var email  = String(b.email  || '').toLowerCase();
    var bookId = String(b.bookId || '');
    var rating = parseInt(b.rating) || 0;

    if (!email || !bookId || rating < 1 || rating > 5)
      return { success: false, error: 'Invalid rating data.' };

    // Check user owns the book
    var purchases = getRows_('Purchases');
    var owns = purchases.find(function(p) {
      return String(p.userEmail).toLowerCase() === email && p.bookId === bookId;
    });
    if (!owns) return { success: false, error: 'You must own this book to rate it.' };

    // Check if already rated
    var ratings = getRows_('Ratings');
    var existing = ratings.find(function(r) {
      return String(r.userEmail).toLowerCase() === email && r.bookId === bookId;
    });
    if (existing) return { success: false, error: 'You have already rated this book.' };

    appendRow_('Ratings', { userEmail: email, bookId: bookId, rating: rating });

    // Update book's average rating
    var bookSh   = ss_().getSheetByName('Books');
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

    return {};
  },

  getAnalytics: function(b) {
    if (!adminCheck_(b)) return { success: false, error: 'Unauthorized.' };

    var users    = getRows_('Users');
    var books    = getRows_('Books');
    var payments = getRows_('Payments');
    var purch    = getRows_('Purchases');

    var approved = payments.filter(function(p) { return p.status === 'Approved'; });
    var pending  = payments.filter(function(p) { return p.status === 'Pending';  });
    var revenue  = approved.reduce(function(sum, p) { return sum + (parseFloat(p.totalAmount) || 0); }, 0);

    return {
      totalUsers:    users.length,
      totalBooks:    books.length,
      totalSales:    purch.length,
      totalRevenue:  revenue,
      pendingCount:  pending.length,
      approvedCount: approved.length
    };
  }
};
