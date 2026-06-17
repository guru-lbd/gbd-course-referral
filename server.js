const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
db.initDatabase()
  .then(() => console.log('Database initialized successfully.'))
  .catch(err => console.error('Database error:', err));


// GET: Check system configurations (e.g. database persistence)
app.get('/api/config', async (req, res) => {
  try {
    const friendDiscountEnabledVal = await db.getSetting('friend_discount_enabled', 'true');
    const friendDiscountPercentStr = await db.getSetting('friend_discount_percent', '10');
    const commissionEnabledVal = await db.getSetting('commission_enabled', 'true');
    const commissionAmountStr = await db.getSetting('commission_amount', '20.00');

    res.json({
      persistentBackend: db.isPostgres || !process.env.VERCEL,
      friendDiscountEnabled: friendDiscountEnabledVal === 'true',
      friendDiscountPercent: parseInt(friendDiscountPercentStr, 10) || 10,
      commissionEnabled: commissionEnabledVal === 'true',
      commissionAmount: parseFloat(commissionAmountStr) || 20.00
    });
  } catch (err) {
    console.error('Config API error:', err);
    res.json({
      persistentBackend: db.isPostgres || !process.env.VERCEL,
      friendDiscountEnabled: true,
      friendDiscountPercent: 10,
      commissionEnabled: true,
      commissionAmount: 20.00
    });
  }
});

/* ==========================================================================
   CLIENT AUTHENTICATION ENDPOINTS
   ========================================================================== */

// POST: Register a new user account and affiliate profile
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, referralCode } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    const existing = await db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    let referred_by = null;
    if (referralCode) {
      const referrerAffiliate = await db.get(
        'SELECT email FROM affiliates WHERE affiliate_code = ?',
        [referralCode.trim().toUpperCase()]
      );
      if (referrerAffiliate) {
        referred_by = referrerAffiliate.email.trim().toLowerCase();
        if (referred_by === email.trim().toLowerCase()) {
          return res.status(400).json({ error: 'You cannot refer yourself.' });
        }
      } else {
        return res.status(400).json({ error: 'Invalid referral code.' });
      }
    }

    // Insert user
    const userResult = await db.run(
      'INSERT INTO users (name, email, password, purchased_courses, referred_by) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), password.trim(), '[]', referred_by]
    );

    // Generate unique code (e.g. CON2991)
    const cleanName = name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const affiliateCode = `${cleanName}${randNum}`;
    const couponCode = `${affiliateCode}-OFF`;

    // Create affiliate profile
    await db.run(
      'INSERT INTO affiliates (name, email, affiliate_code, coupon_code) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), affiliateCode, couponCode]
    );

    const newUser = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      purchased_courses: [],
      referred_by: referred_by,
      affiliate: {
        affiliate_code: affiliateCode,
        coupon_code: couponCode,
        total_clicks: 0,
        total_signups: 0,
        total_commission: 0.00
      }
    };

    await db.logEvent('AffiliateRegistered', {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      affiliate_code: affiliateCode,
      coupon_code: couponCode,
      referred_by: referred_by
    });

    res.json({ success: true, user: newUser });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

// POST: Authenticate user login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(400).json({ error: 'No account found with this email.' });
    }

    if (user.password !== password) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    const affiliate = await db.get(`
      SELECT a.affiliate_code, a.coupon_code,
        (SELECT COUNT(*) FROM clicks WHERE affiliate_id = a.id) as total_clicks,
        (SELECT COUNT(*) FROM signups WHERE affiliate_id = a.id) as total_signups,
        (SELECT COALESCE(SUM(commission_amount), 0.0) FROM signups WHERE affiliate_id = a.id) as total_commission
      FROM affiliates a
      WHERE a.email = ?
    `, [email.trim().toLowerCase()]);

    const courses = JSON.parse(user.purchased_courses || '[]');
    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        purchased_courses: courses,
        referred_by: user.referred_by,
        affiliate: affiliate ? {
          affiliate_code: affiliate.affiliate_code,
          coupon_code: affiliate.coupon_code,
          total_clicks: Number(affiliate.total_clicks) || 0,
          total_signups: Number(affiliate.total_signups) || 0,
          total_commission: Number(affiliate.total_commission) || 0
        } : null
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

/* ==========================================================================
   COURSE ENROLLMENT & COMMISSIONS
   ========================================================================== */

// POST: Purchase a course, attributes commission if referred
app.post('/api/courses/buy', async (req, res) => {
  const { email, courseId } = req.body;
  if (!email || !courseId) {
    return res.status(400).json({ error: 'Email and course ID are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(400).json({ error: 'User not found.' });
    }

    let courses = JSON.parse(user.purchased_courses || '[]');
    if (!courses.includes(Number(courseId))) {
      courses.push(Number(courseId));
    }

    await db.run(
      'UPDATE users SET purchased_courses = ? WHERE email = ?',
      [JSON.stringify(courses), email.trim().toLowerCase()]
    );

    // Check system settings for commission
    const commissionEnabledVal = await db.getSetting('commission_enabled', 'true');
    const commissionEnabled = commissionEnabledVal === 'true';
    const commissionAmountStr = await db.getSetting('commission_amount', '20.00');
    const commissionAmount = parseFloat(commissionAmountStr) || 20.00;

    // Attribute commission if user was referred at signup
    let referralAttributed = false;
    let attributedName = '';

    if (user.referred_by && commissionEnabled) {
      const affiliate = await db.get('SELECT * FROM affiliates WHERE email = ?', [user.referred_by.trim().toLowerCase()]);
      if (affiliate) {
        await db.run(
          'INSERT INTO signups (affiliate_id, friend_email, commission_amount) VALUES (?, ?, ?)',
          [affiliate.id, email.trim().toLowerCase(), commissionAmount]
        );
        
        await db.logEvent('FriendSignedUp', {
          friend_email: email.trim().toLowerCase(),
          affiliate_id: affiliate.id,
          affiliate_name: affiliate.name,
          attribution_source: 'Signup Binding',
          commission_earned: commissionAmount
        });

        referralAttributed = true;
        attributedName = affiliate.name;
      }
    }

    if (!referralAttributed) {
      await db.logEvent('UnattributedSignUp', { friend_email: email.trim().toLowerCase() });
    }

    res.json({
      success: true,
      purchased_courses: courses,
      referredBy: referralAttributed ? attributedName : null
    });

  } catch (err) {
    console.error('Buy course error:', err);
    res.status(500).json({ error: 'Failed to process purchase.' });
  }
});

// POST: Log simulated referral clicks
app.post('/api/clicks/log', async (req, res) => {
  const { affiliateCode, ip } = req.body;
  if (!affiliateCode) {
    return res.status(400).json({ error: 'Affiliate code is required.' });
  }

  try {
    const affiliate = await db.get('SELECT * FROM affiliates WHERE affiliate_code = ?', [affiliateCode.toUpperCase()]);
    if (affiliate) {
      const ipAddress = ip || 'Simulated Visitor';
      await db.run('INSERT INTO clicks (affiliate_id, ip_address) VALUES (?, ?)', [affiliate.id, ipAddress]);
      
      await db.logEvent('ClickCreated', {
        affiliate_code: affiliateCode.toUpperCase(),
        affiliate_name: affiliate.name,
        ip: ipAddress
      });

      return res.json({
        success: true,
        referrerName: affiliate.name,
        couponCode: affiliate.coupon_code
      });
    }
    res.status(400).json({ error: 'Invalid affiliate code.' });

  } catch (err) {
    console.error('Log click error:', err);
    res.status(500).json({ error: 'Failed to log click.' });
  }
});

// GET: Fetch current user profile and affiliate stats
app.get('/api/users/me', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const affiliate = await db.get(`
      SELECT a.affiliate_code, a.coupon_code,
        (SELECT COUNT(*) FROM clicks WHERE affiliate_id = a.id) as total_clicks,
        (SELECT COUNT(*) FROM signups WHERE affiliate_id = a.id) as total_signups,
        (SELECT COALESCE(SUM(commission_amount), 0.0) FROM signups WHERE affiliate_id = a.id) as total_commission
      FROM affiliates a
      WHERE a.email = ?
    `, [email.trim().toLowerCase()]);

    const courses = JSON.parse(user.purchased_courses || '[]');
    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        purchased_courses: courses,
        referred_by: user.referred_by
      },
      affiliate: affiliate ? {
        affiliate_code: affiliate.affiliate_code,
        coupon_code: affiliate.coupon_code,
        total_clicks: Number(affiliate.total_clicks) || 0,
        total_signups: Number(affiliate.total_signups) || 0,
        total_commission: Number(affiliate.total_commission) || 0
      } : null
    });

  } catch (err) {
    console.error('Fetch user me error:', err);
    res.status(500).json({ error: 'Failed to fetch user data.' });
  }
});

// GET: Lookup referrer profile by affiliate code or coupon code
app.get('/api/referrals/lookup', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Code is required.' });
  }

  try {
    const affiliate = await db.get(
      'SELECT * FROM affiliates WHERE affiliate_code = ? OR coupon_code = ?',
      [code.trim().toUpperCase(), code.trim().toUpperCase()]
    );
    
    if (affiliate) {
      return res.json({
        success: true,
        name: affiliate.name,
        email: affiliate.email,
        affiliate_code: affiliate.affiliate_code,
        coupon_code: affiliate.coupon_code
      });
    }
    res.status(404).json({ error: 'Invalid referral code.' });

  } catch (err) {
    console.error('Lookup referral error:', err);
    res.status(500).json({ error: 'Failed to lookup referral.' });
  }
});

/* ==========================================================================
   AFFILIATE REDIRECTS (CLICK TRACKING)
   ========================================================================== */

// GET: Redirect affiliate click, track it, set cookie, and send them home
app.get('/r/:code', async (req, res) => {
  const { code } = req.params;

  try {
    const affiliate = await db.get('SELECT * FROM affiliates WHERE affiliate_code = ?', [code.toUpperCase()]);
    if (!affiliate) {
      return res.redirect('/index.html?error=invalid_code');
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    // Save click in SQLite/Postgres
    await db.run('INSERT INTO clicks (affiliate_id, ip_address) VALUES (?, ?)', [affiliate.id, ipAddress]);
    await db.logEvent('ClickCreated', {
      affiliate_id: affiliate.id,
      affiliate_name: affiliate.name,
      affiliate_code: code.toUpperCase(),
      ip: ipAddress
    });

    // Set cookie (expires in 30 days)
    res.cookie('affiliate_code', affiliate.affiliate_code, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });

    // Redirect to home page
    res.redirect(`/index.html?ref=${affiliate.affiliate_code}`);

  } catch (err) {
    console.error('Click redirect error:', err);
    res.redirect('/index.html?error=server_error');
  }
});

/* ==========================================================================
   ADMINISTRATOR DASHBOARD CRUD ENDPOINTS
   ========================================================================== */

// GET: Fetch unified admin dataset
app.get('/api/admin/data', async (req, res) => {
  try {
    // 1. Fetch user accounts (Sign-up Database)
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    
    // Parse JSON string courses for SQLite
    const parsedUsers = users.map(u => ({
      ...u,
      purchased_courses: typeof u.purchased_courses === 'string' ? JSON.parse(u.purchased_courses) : u.purchased_courses
    }));

    // 2. Fetch affiliates (Referrals database) with stats
    const affiliates = await db.all(`
      SELECT a.*,
        (SELECT COUNT(*) FROM clicks WHERE affiliate_id = a.id) as total_clicks,
        (SELECT COUNT(*) FROM signups WHERE affiliate_id = a.id) as total_signups,
        (SELECT COALESCE(SUM(commission_amount), 0.0) FROM signups WHERE affiliate_id = a.id) as total_commission
      FROM affiliates a
      ORDER BY a.created_at DESC
    `);

    // 3. Fetch recent click events (last 50)
    const clicks = await db.all(`
      SELECT c.*, a.name as affiliate_name 
      FROM clicks c JOIN affiliates a ON c.affiliate_id = a.id
      ORDER BY c.created_at DESC LIMIT 50
    `);

    // 4. Fetch recent signups (last 50)
    const signups = await db.all(`
      SELECT s.*, a.name as affiliate_name 
      FROM signups s JOIN affiliates a ON s.affiliate_id = a.id
      ORDER BY s.created_at DESC LIMIT 50
    `);

    // Fetch all signups without limit to construct the full downline tree
    const allSignups = await db.all('SELECT id, affiliate_id, friend_email FROM signups');

    // 5. Fetch events logs (last 50)
    const events = await db.all('SELECT * FROM event_logs ORDER BY id DESC LIMIT 50');

    res.json({
      users: parsedUsers,
      affiliates,
      clicks,
      signups,
      allSignups,
      events: events.reverse() // Chronological order
    });

  } catch (err) {
    console.error('Admin API error:', err);
    res.status(500).json({ error: 'Failed to load admin dataset.' });
  }
});

// DELETE: Delete a client user account (cascades and clears their affiliate profile)
app.delete('/api/admin/user/:email', async (req, res) => {
  const { email } = req.params;
  try {
    // Delete user from users table
    await db.run('DELETE FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    
    // Delete their affiliate profile (foreign keys delete clicks and signups)
    await db.run('DELETE FROM affiliates WHERE email = ?', [email.trim().toLowerCase()]);

    await db.logEvent('ClientDeleted', { email: email.trim().toLowerCase() });
    res.json({ success: true, message: 'Client account deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete client account.' });
  }
});

// DELETE: Delete a specific affiliate/referral profile
app.delete('/api/admin/affiliate/:code', async (req, res) => {
  const { code } = req.params;
  try {
    await db.run('DELETE FROM affiliates WHERE affiliate_code = ?', [code.trim().toUpperCase()]);
    await db.logEvent('AffiliateDeleted', { affiliate_code: code.trim().toUpperCase() });
    res.json({ success: true, message: 'Referral profile deleted successfully.' });
  } catch (err) {
    console.error('Delete affiliate error:', err);
    res.status(500).json({ error: 'Failed to delete referral profile.' });
  }
});

// PUT: Edit client account details
app.put('/api/admin/user/:email', async (req, res) => {
  const { email } = req.params;
  const { name, password, purchased_courses } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and Password are required.' });
  }

  try {
    const courseArrayStr = JSON.stringify(purchased_courses || []);
    await db.run(
      'UPDATE users SET name = ?, password = ?, purchased_courses = ? WHERE email = ?',
      [name.trim(), password.trim(), courseArrayStr, email.trim().toLowerCase()]
    );

    // Sync name to affiliate profile if they have one
    await db.run('UPDATE affiliates SET name = ? WHERE email = ?', [name.trim(), email.trim().toLowerCase()]);

    await db.logEvent('ClientUpdated', { email: email.trim().toLowerCase(), name: name.trim() });
    res.json({ success: true, message: 'Client account updated successfully.' });

  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update client account.' });
  }
});

// PUT: Edit affiliate profile codes
app.put('/api/admin/affiliate/:code', async (req, res) => {
  const { code } = req.params;
  const { affiliate_code, coupon_code } = req.body;
  if (!affiliate_code || !coupon_code) {
    return res.status(400).json({ error: 'Affiliate Code and Coupon Code are required.' });
  }

  try {
    // Check if new affiliate code is already taken
    const existing = await db.get(
      'SELECT * FROM affiliates WHERE affiliate_code = ? AND affiliate_code != ?',
      [affiliate_code.trim().toUpperCase(), code.trim().toUpperCase()]
    );
    if (existing) {
      return res.status(400).json({ error: 'Affiliate code already in use.' });
    }

    await db.run(
      'UPDATE affiliates SET affiliate_code = ?, coupon_code = ? WHERE affiliate_code = ?',
      [affiliate_code.trim().toUpperCase(), coupon_code.trim().toUpperCase(), code.trim().toUpperCase()]
    );

    await db.logEvent('AffiliateUpdated', {
      old_code: code.trim().toUpperCase(),
      new_code: affiliate_code.trim().toUpperCase(),
      new_coupon: coupon_code.trim().toUpperCase()
    });

    res.json({ success: true, message: 'Referral profile updated successfully.' });

  } catch (err) {
    console.error('Update affiliate error:', err);
    res.status(500).json({ error: 'Failed to update referral profile.' });
  }
});

// GET: Fetch system settings
app.get('/api/admin/settings', async (req, res) => {
  try {
    const friendDiscountEnabled = (await db.getSetting('friend_discount_enabled', 'true')) === 'true';
    const friendDiscountPercent = parseInt(await db.getSetting('friend_discount_percent', '10'), 10) || 10;
    const commissionEnabled = (await db.getSetting('commission_enabled', 'true')) === 'true';
    const commissionAmount = parseFloat(await db.getSetting('commission_amount', '20.00')) || 20.00;

    res.json({
      friend_discount_enabled: friendDiscountEnabled,
      friend_discount_percent: friendDiscountPercent,
      commission_enabled: commissionEnabled,
      commission_amount: commissionAmount
    });
  } catch (err) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// POST: Update system settings
app.post('/api/admin/settings', async (req, res) => {
  const { friend_discount_enabled, friend_discount_percent, commission_enabled, commission_amount } = req.body;
  try {
    if (friend_discount_enabled !== undefined) {
      await db.setSetting('friend_discount_enabled', String(friend_discount_enabled));
    }
    if (friend_discount_percent !== undefined) {
      await db.setSetting('friend_discount_percent', String(friend_discount_percent));
    }
    if (commission_enabled !== undefined) {
      await db.setSetting('commission_enabled', String(commission_enabled));
    }
    if (commission_amount !== undefined) {
      await db.setSetting('commission_amount', String(commission_amount));
    }

    await db.logEvent('SystemSettingsUpdated', {
      friend_discount_enabled,
      friend_discount_percent,
      commission_enabled,
      commission_amount
    });

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// POST: Wipe database and reset seed data
app.post('/api/admin/reset', async (req, res) => {
  try {
    const tables = ['event_logs', 'signups', 'clicks', 'affiliates', 'users', 'system_settings'];
    for (const table of tables) {
      await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.initDatabase();
    res.json({ success: true, message: 'Database reset to clean seed state.' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'Failed to reset database.' });
  }
});

// POST: Clear event activity log
app.post('/api/events/clear', async (req, res) => {
  try {
    await db.run('DELETE FROM event_logs');
    await db.logEvent('ActivityLogCleared', { timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

// Export app
module.exports = app;

// Start server if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`SIMPLIFIED AFFILIATE SYSTEM RUNNING ON PORT ${PORT}`);
    console.log(`Client Portal: http://localhost:${PORT}/index.html`);
    console.log(`Admin Dashboard: http://localhost:${PORT}/admin.html`);
    console.log(`====================================================`);
  });
}
