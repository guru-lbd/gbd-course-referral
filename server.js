const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Verification OTP Store (in-memory)
const otpStore = new Map();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get session email from cookie or Authorization/custom headers
function getSessionEmail(req) {
  let email = req.cookies.session_email;
  if (!email && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      email = authHeader.substring(7);
    }
  }
  if (!email && req.headers['x-session-email']) {
    email = req.headers['x-session-email'];
  }
  return email || null;
}

// Auth Middleware
async function requireAuth(req, res, next) {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  try {
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Session user not found.' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(500).json({ error: 'Authorization error.' });
  }
}

// Role Middleware
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
}

// Initialize database
db.initDatabase()
  .then(() => console.log('Database initialized successfully.'))
  .catch(err => console.error('Database error:', err));

// Helper to parse dates in local timezone
function parseLocalDate(dateStr) {
  if (!dateStr || dateStr === 'Pending') return new Date(NaN);
  let s = dateStr.trim();
  if (s.includes(' ')) {
    s = s.replace(' ', 'T');
  }
  if (!s.includes('T') && s.length <= 10) {
    s = s + 'T00:00';
  }
  return new Date(s);
}

// Gating Helper Function for GAP Page and Payment
async function resolveUserGating(user) {
  if (!user) return { gapPageActive: false, gapPaymentActive: false };
  
  const batchId = user.batch_id || 0;
  const manualGapActiveSetting = await db.getSetting(`gap_page_active_${batchId}`, 'true');
  const manualGapActive = manualGapActiveSetting === 'true';

  const manualPaymentActiveSetting = await db.getSetting(`gap_payment_active_${batchId}`, 'false');
  const manualPaymentActive = manualPaymentActiveSetting === 'true';

  const currentTime = new Date();

  let isMasterclassPassed = false;
  if (user.masterclass_date) {
    const masterclassTime = parseLocalDate(user.masterclass_date);
    isMasterclassPassed = !isNaN(masterclassTime.getTime()) && currentTime >= masterclassTime;
  }

  let isGapPassed = false;
  if (user.gap_date) {
    const gapTime = parseLocalDate(user.gap_date);
    isGapPassed = !isNaN(gapTime.getTime()) && currentTime >= gapTime;
  }

  return {
    gapPageActive: manualGapActive || isMasterclassPassed,
    gapPaymentActive: manualPaymentActive || isGapPassed
  };
}


// GET: Check system configurations (e.g. database persistence)
app.get('/api/config', async (req, res) => {
  try {
    const friendDiscountEnabledVal = await db.getSetting('friend_discount_enabled', 'true');
    const friendDiscountPercentStr = await db.getSetting('friend_discount_percent', '10');
    const commissionEnabledVal = await db.getSetting('commission_enabled', 'true');
    const commissionAmountStr = await db.getSetting('commission_amount', '20.00');
    const gapPageActive1Val = await db.getSetting('gap_page_active_1', 'true');
    const gapPageActive2Val = await db.getSetting('gap_page_active_2', 'true');
    const gapPageActive3Val = await db.getSetting('gap_page_active_3', 'true');

    res.json({
      persistentBackend: db.isPostgres || !process.env.VERCEL,
      isPostgres: db.isPostgres,
      friendDiscountEnabled: friendDiscountEnabledVal === 'true',
      friendDiscountPercent: parseInt(friendDiscountPercentStr, 10) || 10,
      commissionEnabled: commissionEnabledVal === 'true',
      commissionAmount: parseFloat(commissionAmountStr) || 20.00,
      gapPageActive1: gapPageActive1Val === 'true',
      gapPageActive2: gapPageActive2Val === 'true',
      gapPageActive3: gapPageActive3Val === 'true'
    });
  } catch (err) {
    console.error('Config API error:', err);
    res.json({
      persistentBackend: db.isPostgres || !process.env.VERCEL,
      isPostgres: db.isPostgres,
      friendDiscountEnabled: true,
      friendDiscountPercent: 10,
      commissionEnabled: true,
      commissionAmount: 20.00,
      gapPageActive1: true,
      gapPageActive2: true,
      gapPageActive3: true
    });
  }
});

/* ==========================================================================
   LBDA CORE AUTHENTICATION & SESSION ENDPOINTS
   ========================================================================== */

// POST: Request Email & Phone OTP (Double-OTP Flow)
app.post('/api/auth/request-otp', async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) {
    return res.status(400).json({ error: 'Email and phone number are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // Check if user exists in imported database with matching email AND phone
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(email) = ? AND phone = ?',
      [cleanEmail, cleanPhone]
    );

    if (!user) {
      return res.json({
        success: false,
        message: 'Access Restricted. Please contact LBDA support.'
      });
    }

    // Generate a single 6-digit OTP code for both channels
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const emailOtp = otp;
    const phoneOtp = otp;
    const expiresAt = Date.now() + 10 * 60 * 1000; // Expires in 10 minutes

    // Store in active OTP pool
    otpStore.set(cleanEmail, { emailOtp, phoneOtp, expiresAt });

    console.log(`[AUTH OTP] Generated code for ${cleanEmail}: OTP = ${otp}`);

    // Queue in notifications table
    await db.run(
      'INSERT INTO notifications (user_id, channel, subject, message, status, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, 'EMAIL', 'LBDA Login Verification', `Your verification code is ${otp}`, 'PENDING', new Date().toISOString()]
    );
    await db.run(
      'INSERT INTO notifications (user_id, channel, subject, message, status, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, 'WHATSAPP', null, `Your verification code is ${otp}`, 'PENDING', new Date().toISOString()]
    );

    res.json({
      success: true,
      message: 'OTPs sent to your email and phone.'
    });

  } catch (err) {
    console.error('Request OTP error:', err);
    res.status(500).json({ error: 'Failed to request OTP.' });
  }
});

// POST: Verify Email & Phone OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, emailOtp, phoneOtp } = req.body;
  if (!email || !emailOtp || !phoneOtp) {
    return res.status(400).json({ error: 'Email, Email OTP, and Phone OTP are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const otpData = otpStore.get(cleanEmail);

    if (!otpData) {
      return res.status(400).json({ success: false, message: 'No active OTP request found for this email.' });
    }

    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ success: false, message: 'Your OTPs have expired. Please request new codes.' });
    }

    const cleanEmailOtp = String(emailOtp).trim();
    const cleanPhoneOtp = String(phoneOtp).trim();

    if (otpData.emailOtp !== cleanEmailOtp || otpData.phoneOtp !== cleanPhoneOtp) {
      return res.status(400).json({ success: false, message: 'Incorrect verification codes. Please try again.' });
    }

    // Clear verification session on success
    otpStore.delete(cleanEmail);

    let user = await db.get(`
      SELECT u.*, b.name as batch_name, b.code as batch_code, b.masterclass_date, b.registration_date, b.gap_date, b.bridge_date
      FROM users u
      LEFT JOIN batches b ON u.batch_id = b.id
      WHERE LOWER(u.email) = ?
    `, [cleanEmail]);
    if (!user) {
      return res.status(404).json({ error: 'User record not found.' });
    }

    await db.syncUserStageAndProgress(user.id);
    
    // Refresh user record with updated stage
    user = await db.get(`
      SELECT u.*, b.name as batch_name, b.code as batch_code, b.masterclass_date, b.registration_date, b.gap_date, b.bridge_date
      FROM users u
      LEFT JOIN batches b ON u.batch_id = b.id
      WHERE LOWER(u.email) = ?
    `, [cleanEmail]);

    // Setup cross-subdomain tracking cookie if parent domain is configured
    const parentDomain = process.env.PARENT_DOMAIN || null;
    const cookieOptions = {
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      httpOnly: true,
      path: '/'
    };
    if (parentDomain) {
      cookieOptions.domain = parentDomain;
    }

    res.cookie('session_email', user.email, cookieOptions);
    res.cookie('session_role', user.role, cookieOptions);

    await db.logEvent('UserLoggedIn', { email: user.email, role: user.role });

    const gating = await resolveUserGating(user);

    res.json({
      success: true,
      message: 'Login successful.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        current_stage: user.current_stage,
        batch_id: user.batch_id,
        batch_name: user.batch_name,
        batch_code: user.batch_code,
        masterclass_date: user.masterclass_date,
        gap_date: user.gap_date,
        gap_page_active: gating.gapPageActive,
        gap_payment_active: gating.gapPaymentActive
      }
    });

  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Failed to verify OTP.' });
  }
});

// POST: Fast path quick login for admin impersonation or quick role switching
app.post('/api/auth/quick-login', async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) {
    return res.status(400).json({ error: 'Email and phone number are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // Verify user exists with matching email AND phone
    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(email) = ? AND phone = ?',
      [cleanEmail, cleanPhone]
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Access Restricted. Invalid credentials.'
      });
    }

    // Set cookies directly (bypassing OTP entirely!)
    const parentDomain = process.env.PARENT_DOMAIN || null;
    const cookieOptions = {
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      httpOnly: true,
      path: '/'
    };
    if (parentDomain) {
      cookieOptions.domain = parentDomain;
    }

    res.cookie('session_email', user.email, cookieOptions);
    res.cookie('session_role', user.role, cookieOptions);

    await db.logEvent('UserQuickLoggedIn', { email: user.email, role: user.role });

    // Sync user stage and progress
    await db.syncUserStageAndProgress(user.id);

    res.json({
      success: true,
      message: 'Quick login successful.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        current_stage: user.current_stage,
        batch_id: user.batch_id
      }
    });

  } catch (err) {
    console.error('Quick login error:', err);
    res.status(500).json({ error: 'Failed to process quick login.' });
  }
});

// POST: Logout user
app.post('/api/auth/logout', (req, res) => {
  const parentDomain = process.env.PARENT_DOMAIN || null;
  const cookieOptions = { path: '/' };
  if (parentDomain) {
    cookieOptions.domain = parentDomain;
  }
  res.clearCookie('session_email', cookieOptions);
  res.clearCookie('session_role', cookieOptions);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// GET: Debug active OTPs (development only)
app.get('/api/debug/otps', (req, res) => {
  const otps = {};
  for (const [email, data] of otpStore.entries()) {
    otps[email] = data;
  }
  res.json({ success: true, otps });
});

// GET: Current user session details
app.get('/api/user', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ authenticated: false, error: 'Unauthorized.' });
  }

  try {
    let user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ authenticated: false, error: 'User session not found.' });
    }

    await db.syncUserStageAndProgress(user.id);
    user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        current_stage: user.current_stage,
        batch_id: user.batch_id
      }
    });
  } catch (err) {
    console.error('API user error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET: Current user stage, progress, and metadata
app.get('/api/dashboard', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    let user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await db.syncUserStageAndProgress(user.id);
    user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);

    const batch = await db.get('SELECT * FROM batches WHERE id = ?', [user.batch_id]);
    const progress = await db.get('SELECT * FROM user_progress WHERE user_id = ?', [user.id]);

    let partnerInfo = null;
    if (user.role === 'PARTNER' || user.current_stage === 'PARTNER') {
      const referralCode = `${user.name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase()}${String(user.id).padStart(3, '0')}`;
      const referralLink = `center.lifebydesign.com/ref/${referralCode}`;
      
      const referrals = await db.all('SELECT * FROM referrals WHERE partner_id = ?', [user.id]);
      const earnings = await db.all('SELECT * FROM earnings WHERE partner_id = ?', [user.id]);
      
      partnerInfo = {
        referralCode,
        referralLink,
        referralsCount: referrals.length,
        earnings
      };
    }

    let stageMetadata = {};
    switch (user.current_stage) {
      case 'INVITED':
        stageMetadata = {
          message: 'Welcome to Life By Design Academy! You have been invited.'
        };
        break;
      case 'MASTERCLASS':
        stageMetadata = {
          title: 'Masterclass Scheduling',
          date: batch ? batch.masterclass_date : 'Pending',
          time: '10:00 AM',
          duration: '3 hours',
          link: 'https://zoom.us/j/masterclass-mock-id',
          status: progress ? (progress.masterclass_attended ? 'Attended' : 'Pending') : 'Pending'
        };
        break;
      case 'REGISTRATION':
        stageMetadata = {
          instructions: 'Please complete your registration form to unlock the next stages.',
          status: progress ? (progress.registration_completed ? 'Completed' : 'Pending') : 'Pending'
        };
        break;
      case 'GAP':
        stageMetadata = {
          title: 'GAP Online Session',
          date: batch ? batch.gap_date : 'Pending',
          time: '4:00 PM',
          duration: '2 hours',
          meetingLink: 'https://zoom.us/j/gap-mock-id',
          instructions: 'Ensure you join from a quiet place with a working camera.'
        };
        break;
      case 'PAYMENT_1':
        stageMetadata = {
          paymentType: 'PAYMENT_1',
          amount: 100000,
          currency: 'INR',
          description: 'First installment of Academy certification program'
        };
        break;
      case 'BRIDGE':
        stageMetadata = {
          title: 'Bridge Curriculum',
          schedule: 'Week 1: Online, Week 2: Online, Week 3: Online, Week 4: Final Chennai Session',
          venue: 'Academy Campus, Chennai',
          date: batch ? batch.bridge_date : 'Pending',
          requirements: 'Laptop, Notebook, and Certificate of Attendance.'
        };
        break;
      case 'PAYMENT_2':
        stageMetadata = {
          paymentType: 'PAYMENT_2',
          amount: 200000,
          currency: 'INR',
          description: 'Second installment of Academy certification program'
        };
        break;
      case 'CERTIFICATION':
        stageMetadata = {
          message: 'Congratulations! You have completed the training and are awaiting Partner Activation.'
        };
        break;
      case 'PARTNER':
        stageMetadata = {
          message: 'Congratulations, You are now a Life Design Partner.',
          partnerInfo
        };
        break;
    }

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        current_stage: user.current_stage
      },
      batch,
      progress,
      stageMetadata
    });

  } catch (err) {
    console.error('API dashboard error:', err);
    res.status(500).json({ error: 'Internal server error.' });
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
      const cleanCode = referralCode.trim().toUpperCase().replace(/-OFF$/, '');
      const referrerAffiliate = await db.get(
        'SELECT email FROM affiliates WHERE affiliate_code = ?',
        [cleanCode]
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
    const cleanCode = affiliateCode.toUpperCase().replace(/-OFF$/, '');
    const affiliate = await db.get('SELECT * FROM affiliates WHERE affiliate_code = ?', [cleanCode]);
    if (affiliate) {
      const ipAddress = ip || 'Simulated Visitor';
      await db.run('INSERT INTO clicks (affiliate_id, ip_address) VALUES (?, ?)', [affiliate.id, ipAddress]);
      
      await db.logEvent('ClickCreated', {
        affiliate_code: cleanCode,
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

  const sessionEmail = getSessionEmail(req);
  if (!sessionEmail || sessionEmail.toLowerCase() !== email.trim().toLowerCase()) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const checkUser = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email.trim().toLowerCase()]);
    if (checkUser) {
      await db.syncUserStageAndProgress(checkUser.id);
    }

    const user = await db.get(`
      SELECT u.*, b.name as batch_name, b.code as batch_code, b.masterclass_date, b.registration_date, b.gap_date, b.bridge_date
      FROM users u
      LEFT JOIN batches b ON u.batch_id = b.id
      WHERE LOWER(u.email) = ?
    `, [email.trim().toLowerCase()]);
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
    const gating = await resolveUserGating(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        current_stage: user.current_stage,
        purchased_courses: courses,
        referred_by: user.referred_by,
        batch_id: user.batch_id,
        batch_name: user.batch_name,
        batch_code: user.batch_code,
        masterclass_date: user.masterclass_date,
        gap_date: user.gap_date,
        gap_page_active: gating.gapPageActive,
        gap_payment_active: gating.gapPaymentActive
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
    const searchCode = code.trim();
    const affiliate = await db.get(
      'SELECT * FROM affiliates WHERE affiliate_code = ? OR coupon_code = ? OR LOWER(email) = ?',
      [searchCode.toUpperCase(), searchCode.toUpperCase(), searchCode.toLowerCase()]
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
app.get('/api/admin/data', requireAuth, requireRole(['MD', 'OPERATIONS', 'FINANCE']), async (req, res) => {
  try {
    await db.syncAllUsersStageAndProgress();
    const [
      users,
      batches,
      payments,
      notifications,
      referrals,
      earnings,
      auditLogs,
      events
    ] = await Promise.all([
      db.all('SELECT u.*, b.name as batch_name FROM users u LEFT JOIN batches b ON u.batch_id = b.id ORDER BY u.created_at DESC'),
      db.all('SELECT * FROM batches ORDER BY id ASC'),
      db.all('SELECT p.*, u.name as user_name FROM payments p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC'),
      db.all('SELECT n.*, u.name as user_name FROM notifications n LEFT JOIN users u ON n.user_id = u.id ORDER BY n.id DESC LIMIT 50'),
      db.all('SELECT r.*, p.name as partner_name, s.name as student_name FROM referrals r JOIN users p ON r.partner_id = p.id JOIN users s ON r.student_id = s.id ORDER BY r.created_at DESC'),
      db.all('SELECT e.*, u.name as partner_name FROM earnings e JOIN users u ON e.partner_id = u.id ORDER BY e.created_at DESC'),
      db.all('SELECT a.*, u.name as actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id ORDER BY a.id DESC LIMIT 50'),
      db.all('SELECT * FROM event_logs ORDER BY id DESC LIMIT 50')
    ]);

    res.json({
      success: true,
      users,
      batches,
      payments,
      notifications,
      referrals,
      earnings,
      auditLogs,
      events: events.reverse()
    });

  } catch (err) {
    console.error('Admin API error:', err);
    res.status(500).json({ error: 'Failed to load admin dataset.', details: err.message });
  }
});

// DELETE: Delete a client user account (cascades and clears their affiliate profile)
app.delete('/api/admin/user/:email', requireAuth, requireRole(['MD']), async (req, res) => {
  const { email } = req.params;
  try {
    // Delete user from users table
    await db.run('DELETE FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    
    // Delete their affiliate profile if table exists (ignore if not)
    try {
      await db.run('DELETE FROM affiliates WHERE email = ?', [email.trim().toLowerCase()]);
    } catch (e) {
      // Ignored: legacy table not present in current schema
    }

    await db.logEvent('ClientDeleted', { email: email.trim().toLowerCase() });
    res.json({ success: true, message: 'Client account deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete client account.' });
  }
});

// DELETE: Delete a specific affiliate/referral profile
app.delete('/api/admin/affiliate/:code', requireAuth, requireRole(['MD']), async (req, res) => {
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
app.put('/api/admin/user/:email', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { email } = req.params;
  const { name, phone, role, current_stage, batch_id } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and Phone are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.trim().toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const oldUser = { ...user };
    const newRole = role || user.role;
    const newStage = current_stage || user.current_stage;
    const newPhone = phone || user.phone;
    const newBatchId = batch_id !== undefined ? batch_id : user.batch_id;

    await db.run(
      'UPDATE users SET name = ?, phone = ?, role = ?, current_stage = ?, batch_id = ?, updated_at = ? WHERE email = ?',
      [name.trim(), newPhone.trim(), newRole, newStage, newBatchId, new Date().toISOString(), email.trim().toLowerCase()]
    );

    await db.syncUserStageAndProgress(user.id, true);

    await db.logAudit(1, 'AdminUpdateUser', 'users', user.id, oldUser, {
      name: name.trim(),
      phone: newPhone.trim(),
      role: newRole,
      current_stage: newStage,
      batch_id: newBatchId
    });

    res.json({ success: true, message: 'User details updated successfully.' });

  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// POST: Create a new user (Admin invite/creation)
app.post('/api/admin/user', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { name, email, phone, role, current_stage, batch_id } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Name, email, and phone are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    const resUser = await db.run(
      'INSERT INTO users (name, email, phone, role, current_stage, batch_id) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), cleanEmail, phone.trim(), role || 'USER', current_stage || 'INVITED', batch_id || null]
    );

    const newUserId = resUser.id;
    if (newUserId) {
      await db.run(
        'INSERT INTO user_progress (user_id) VALUES (?)',
        [newUserId]
      );
      await db.syncUserStageAndProgress(newUserId, true);
    }

    await db.logEvent('UserCreatedByAdmin', { email: cleanEmail, role: role || 'USER' });
    res.json({ success: true, message: 'User created successfully.', userId: newUserId });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PUT: Rearrange/move client node in tree (change referrer)
app.put('/api/admin/user/:email/referrer', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { email } = req.params;
  const { referred_by } = req.body; // Can be a string email, or empty/null to remove referrer

  const targetEmail = email.trim().toLowerCase();
  const newReferrer = referred_by ? referred_by.trim().toLowerCase() : null;

  try {
    // 1. Verify user exists
    const user = await db.get('SELECT * FROM users WHERE email = ?', [targetEmail]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (newReferrer) {
      // 2. Verify new referrer exists
      const referrer = await db.get('SELECT * FROM users WHERE email = ?', [newReferrer]);
      if (!referrer) {
        return res.status(400).json({ error: 'Selected referrer user does not exist.' });
      }

      // 3. Prevent self-referral
      if (targetEmail === newReferrer) {
        return res.status(400).json({ error: 'A client cannot refer themselves.' });
      }

      // 4. Cycle prevention (ensure newReferrer is not already in the target user's downline)
      const usersList = await db.all('SELECT email, referred_by FROM users');
      const userMap = {};
      usersList.forEach(u => {
        userMap[u.email.toLowerCase()] = u.referred_by ? u.referred_by.toLowerCase() : null;
      });

      let current = newReferrer;
      const visited = new Set();
      while (current) {
        if (current === targetEmail) {
          return res.status(400).json({ error: 'Circular reference detected: cannot move a client under their own downline.' });
        }
        if (visited.has(current)) {
          break; // Avoid infinite loop in case of existing cycles
        }
        visited.add(current);
        current = userMap[current] || null;
      }
    }

    // 5. Update user referred_by
    const oldReferrer = user.referred_by;
    await db.run('UPDATE users SET referred_by = ? WHERE email = ?', [newReferrer, targetEmail]);

    await db.logEvent('ClientReferrerUpdated', {
      email: targetEmail,
      old_referred_by: oldReferrer,
      new_referred_by: newReferrer
    });

    res.json({ success: true, message: 'Client referrer updated successfully.' });

  } catch (err) {
    console.error('Update referrer error:', err);
    res.status(500).json({ error: 'Failed to update client referrer.' });
  }
});


// PUT: Edit affiliate profile codes
app.put('/api/admin/affiliate/:code', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
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
app.get('/api/admin/settings', requireAuth, requireRole(['MD', 'OPERATIONS', 'FINANCE']), async (req, res) => {
  try {
    const friendDiscountEnabled = (await db.getSetting('friend_discount_enabled', 'true')) === 'true';
    const friendDiscountPercent = parseInt(await db.getSetting('friend_discount_percent', '10'), 10) || 10;
    const commissionEnabled = (await db.getSetting('commission_enabled', 'true')) === 'true';
    const commissionAmount = parseFloat(await db.getSetting('commission_amount', '20.00')) || 20.00;
    const gapPageActive1 = (await db.getSetting('gap_page_active_1', 'true')) === 'true';
    const gapPageActive2 = (await db.getSetting('gap_page_active_2', 'true')) === 'true';
    const gapPageActive3 = (await db.getSetting('gap_page_active_3', 'true')) === 'true';
    const gapPaymentActive1 = (await db.getSetting('gap_payment_active_1', 'false')) === 'true';
    const gapPaymentActive2 = (await db.getSetting('gap_payment_active_2', 'false')) === 'true';
    const gapPaymentActive3 = (await db.getSetting('gap_payment_active_3', 'false')) === 'true';

    res.json({
      friend_discount_enabled: friendDiscountEnabled,
      friend_discount_percent: friendDiscountPercent,
      commission_enabled: commissionEnabled,
      commission_amount: commissionAmount,
      gap_page_active_1: gapPageActive1,
      gap_page_active_2: gapPageActive2,
      gap_page_active_3: gapPageActive3,
      gap_payment_active_1: gapPaymentActive1,
      gap_payment_active_2: gapPaymentActive2,
      gap_payment_active_3: gapPaymentActive3
    });
  } catch (err) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// POST: Update system settings
app.post('/api/admin/settings', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { friend_discount_enabled, friend_discount_percent, commission_enabled, commission_amount, gap_page_active_1, gap_page_active_2, gap_page_active_3, gap_payment_active_1, gap_payment_active_2, gap_payment_active_3 } = req.body;
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
    if (gap_page_active_1 !== undefined) {
      await db.setSetting('gap_page_active_1', String(gap_page_active_1));
    }
    if (gap_page_active_2 !== undefined) {
      await db.setSetting('gap_page_active_2', String(gap_page_active_2));
    }
    if (gap_page_active_3 !== undefined) {
      await db.setSetting('gap_page_active_3', String(gap_page_active_3));
    }
    if (gap_payment_active_1 !== undefined) {
      await db.setSetting('gap_payment_active_1', String(gap_payment_active_1));
    }
    if (gap_payment_active_2 !== undefined) {
      await db.setSetting('gap_payment_active_2', String(gap_payment_active_2));
    }
    if (gap_payment_active_3 !== undefined) {
      await db.setSetting('gap_payment_active_3', String(gap_payment_active_3));
    }

    await db.logEvent('SystemSettingsUpdated', {
      friend_discount_enabled,
      friend_discount_percent,
      commission_enabled,
      commission_amount,
      gap_page_active_1,
      gap_page_active_2,
      gap_page_active_3,
      gap_payment_active_1,
      gap_payment_active_2,
      gap_payment_active_3
    });

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// POST: Wipe database and reset seed data
app.post('/api/admin/reset', requireAuth, requireRole(['MD']), async (req, res) => {
  try {
    const tables = [
      'audit_logs',
      'event_logs',
      'earnings',
      'referrals',
      'notifications',
      'payments',
      'user_progress',
      'users',
      'batches',
      'system_settings',
      'signups',
      'clicks',
      'affiliates'
    ];
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
app.post('/api/events/clear', requireAuth, requireRole(['MD']), async (req, res) => {
  try {
    await db.run('DELETE FROM event_logs');
    await db.logEvent('ActivityLogCleared', { timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear logs.' });
  }
});

/* ==========================================================================
   LBDA BATCH & STAGE ENGINE ENDPOINTS
   ========================================================================= */

// GET: Retrieve all batches
app.get('/api/batches', async (req, res) => {
  try {
    const batches = await db.all('SELECT * FROM batches ORDER BY id ASC');
    res.json({ success: true, batches });
  } catch (err) {
    console.error('Get batches error:', err);
    res.status(500).json({ error: 'Failed to retrieve batches.' });
  }
});

// POST: Modify batch dates with optional 2-day gap cascade
app.post('/api/admin/change-batch-dates', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { batchId, masterclassDate, registrationDate, gapDate, bridgeDate, cascade, gapPageActive, gapPaymentActive } = req.body;
  if (!batchId) {
    return res.status(400).json({ error: 'Batch ID is required.' });
  }

  try {
    const batch = await db.get('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' });
    }

    const oldBatch = { ...batch };
    const newMasterclassDate = masterclassDate || batch.masterclass_date;
    const newRegistrationDate = registrationDate || batch.registration_date;
    const newGapDate = gapDate || batch.gap_date;
    const newBridgeDate = bridgeDate || batch.bridge_date;

    await db.run(`
      UPDATE batches 
      SET masterclass_date = ?, registration_date = ?, gap_date = ?, bridge_date = ? 
      WHERE id = ?`,
      [newMasterclassDate, newRegistrationDate, newGapDate, newBridgeDate, batchId]
    );

    if (gapPageActive !== undefined) {
      await db.setSetting(`gap_page_active_${batchId}`, String(gapPageActive));
    }

    if (gapPaymentActive !== undefined) {
      await db.setSetting(`gap_payment_active_${batchId}`, String(gapPaymentActive));
    }

    await db.logAudit(1, 'UpdateBatchDates', 'batches', batchId, oldBatch, {
      masterclass_date: newMasterclassDate,
      registration_date: newRegistrationDate,
      gap_date: newGapDate,
      bridge_date: newBridgeDate
    });

    // Default gap logic scheduling cascade (OBS -> 2 days -> NBS -> 2 days -> SSC)
    if (cascade && masterclassDate) {
      const dateObj = new Date(masterclassDate);
      
      if (batch.code === 'OLD_BIG_SISTER') {
        const nbsDate = new Date(dateObj);
        nbsDate.setDate(dateObj.getDate() + 2);
        const nbsDateStr = nbsDate.toISOString().split('T')[0];

        const sscDate = new Date(dateObj);
        sscDate.setDate(dateObj.getDate() + 4);
        const sscDateStr = sscDate.toISOString().split('T')[0];

        const nbs = await db.get("SELECT * FROM batches WHERE code = 'NEW_BIG_SISTER'");
        if (nbs) {
          await db.run(
            'UPDATE batches SET masterclass_date = ?, registration_date = ?, gap_date = ?, bridge_date = ? WHERE id = ?',
            [nbsDateStr, nbsDateStr, nbsDateStr, nbsDateStr, nbs.id]
          );
        }

        const ssc = await db.get("SELECT * FROM batches WHERE code = 'SS_CERTIFIED'");
        if (ssc) {
          await db.run(
            'UPDATE batches SET masterclass_date = ?, registration_date = ?, gap_date = ?, bridge_date = ? WHERE id = ?',
            [sscDateStr, sscDateStr, sscDateStr, sscDateStr, ssc.id]
          );
        }
      } else if (batch.code === 'NEW_BIG_SISTER') {
        const sscDate = new Date(dateObj);
        sscDate.setDate(dateObj.getDate() + 2);
        const sscDateStr = sscDate.toISOString().split('T')[0];

        const ssc = await db.get("SELECT * FROM batches WHERE code = 'SS_CERTIFIED'");
        if (ssc) {
          await db.run(
            'UPDATE batches SET masterclass_date = ?, registration_date = ?, gap_date = ?, bridge_date = ? WHERE id = ?',
            [sscDateStr, sscDateStr, sscDateStr, sscDateStr, ssc.id]
          );
        }
      }
    }

    const updatedBatches = await db.all('SELECT * FROM batches');
    res.json({
      success: true,
      message: 'Batch dates updated successfully.',
      batches: updatedBatches
    });

  } catch (err) {
    console.error('Update batch dates error:', err);
    res.status(500).json({ error: 'Failed to update batch dates.' });
  }
});

// POST: Admin manual stage override
app.post('/api/admin/change-stage', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId, newStage } = req.body;
  const STAGES = [
    "INVITED",
    "MASTERCLASS",
    "REGISTRATION",
    "GAP",
    "PAYMENT_1",
    "BRIDGE",
    "PAYMENT_2",
    "CERTIFICATION",
    "PARTNER"
  ];

  if (!userId || !newStage) {
    return res.status(400).json({ error: 'User ID and new stage are required.' });
  }

  if (!STAGES.includes(newStage.toUpperCase())) {
    return res.status(400).json({ error: `Invalid stage. Must be one of: ${STAGES.join(', ')}` });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const oldStage = user.current_stage;
    const targetStage = newStage.toUpperCase();

    // Update stage in database
    await db.run('UPDATE users SET current_stage = ?, updated_at = ? WHERE id = ?', [targetStage, new Date().toISOString(), userId]);

    // If target stage is PARTNER, update role to PARTNER
    if (targetStage === 'PARTNER') {
      await db.run("UPDATE users SET role = 'PARTNER' WHERE id = ?", [userId]);
      
      const cleanName = user.name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
      const referralCode = `${cleanName}${String(userId).padStart(3, '0')}`;
      const referralLink = `center.lifebydesign.com/ref/${referralCode}`;
      
      await db.logEvent('PartnerActivated', { userId, name: user.name, referralCode, referralLink });
    }

    await db.logAudit(1, 'ManualStageChange', 'users', userId, { current_stage: oldStage }, { current_stage: targetStage });

    // Sync progress checkboxes to match the new stage
    await db.syncUserStageAndProgress(userId, true);

    res.json({
      success: true,
      message: `User stage changed from ${oldStage} to ${targetStage} successfully.`
    });

  } catch (err) {
    console.error('Change stage error:', err);
    res.status(500).json({ error: 'Failed to change stage.' });
  }
});

// POST: Self registration complete (advances from REGISTRATION to GAP)
app.post('/api/register', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const { name, phone } = req.body;

  try {
    const user = await db.get(`
      SELECT u.*, b.masterclass_date, b.gap_date
      FROM users u
      LEFT JOIN batches b ON u.batch_id = b.id
      WHERE LOWER(u.email) = ?
    `, [email.toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const gating = await resolveUserGating(user);
    const isAllowedToRegister = ['INVITED', 'MASTERCLASS', 'REGISTRATION'].includes(user.current_stage) && gating.gapPageActive;

    if (!isAllowedToRegister) {
      return res.status(400).json({ error: 'Registration is not available at your current stage.' });
    }

    const regLock = await db.getSetting('registration_locked', 'false');
    if (regLock === 'true') {
      return res.status(400).json({ error: 'Registration is currently locked. Please contact support.' });
    }

    if (name || phone) {
      await db.run(
        'UPDATE users SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name || user.name, phone || user.phone, user.id]
      );
    }

    await db.run('UPDATE user_progress SET registration_completed = true WHERE user_id = ?', [user.id]);
    await db.run('UPDATE users SET current_stage = ? WHERE id = ?', ['GAP', user.id]);
    
    await db.logAudit(user.id, 'SelfRegistrationCompleted', 'users', user.id, { current_stage: user.current_stage }, { current_stage: 'GAP' });
    await db.logEvent('RegistrationCompleted', { userId: user.id, email: user.email });

    res.json({
      success: true,
      message: 'Registration completed successfully. You have advanced to GAP stage.',
      nextStage: 'GAP'
    });

  } catch (err) {
    console.error('Self registration error:', err);
    res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

// POST: Admin marks Masterclass attendance (advances from MASTERCLASS to REGISTRATION)
app.post('/api/admin/masterclass/attendance', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !status) {
    return res.status(400).json({ error: 'User ID and status are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.current_stage !== 'MASTERCLASS') {
      return res.status(400).json({ error: 'User is not currently in the MASTERCLASS stage.' });
    }

    const attended = status === 'Attended';
    await db.run('UPDATE user_progress SET masterclass_attended = ? WHERE user_id = ?', [attended, userId]);
    await db.logEvent('AttendanceMarked', { userId, status, sessionType: 'MASTERCLASS' });

    let nextStage = 'MASTERCLASS';
    if (status === 'Attended') {
      nextStage = 'REGISTRATION';
      await db.run('UPDATE users SET current_stage = ? WHERE id = ?', [nextStage, userId]);
      await db.logAudit(1, 'MasterclassAttendanceAdvancement', 'users', userId, { current_stage: 'MASTERCLASS' }, { current_stage: nextStage });
    }

    res.json({
      success: true,
      message: `Masterclass attendance marked as ${status}.`,
      currentStage: nextStage
    });

  } catch (err) {
    console.error('Mark attendance error:', err);
    res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

// POST: Complete GAP online Zoom session (advances from GAP to PAYMENT_1)
app.post('/api/admin/gap/complete', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.current_stage !== 'GAP') {
      return res.status(400).json({ error: 'User is not currently in the GAP stage.' });
    }

    await db.run('UPDATE user_progress SET gap_completed = true WHERE user_id = ?', [userId]);
    await db.run('UPDATE users SET current_stage = ? WHERE id = ?', ['PAYMENT_1', userId]);

    await db.logAudit(1, 'GapSessionCompleted', 'users', userId, { current_stage: 'GAP' }, { current_stage: 'PAYMENT_1' });
    await db.logEvent('GapCompleted', { userId });

    res.json({
      success: true,
      message: 'Gap stage completed. Advanced to PAYMENT_1.'
    });

  } catch (err) {
    console.error('Complete gap error:', err);
    res.status(500).json({ error: 'Failed to complete Gap stage.' });
  }
});

// POST: Complete Bridge sessions (advances from BRIDGE to PAYMENT_2)
app.post('/api/admin/bridge/complete', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.current_stage !== 'BRIDGE') {
      return res.status(400).json({ error: 'User is not currently in the BRIDGE stage.' });
    }

    await db.run('UPDATE user_progress SET bridge_completed = true WHERE user_id = ?', [userId]);
    await db.run('UPDATE users SET current_stage = ? WHERE id = ?', ['PAYMENT_2', userId]);

    await db.logAudit(1, 'BridgeCompleted', 'users', userId, { current_stage: 'BRIDGE' }, { current_stage: 'PAYMENT_2' });
    await db.logEvent('BridgeCompleted', { userId });

    res.json({
      success: true,
      message: 'Bridge completed. Advanced to PAYMENT_2.'
    });

  } catch (err) {
    console.error('Complete bridge error:', err);
    res.status(500).json({ error: 'Failed to complete Bridge stage.' });
  }
});

// POST: Certify graduate and activate as Partner (advances from CERTIFICATION to PARTNER)
app.post('/api/admin/certify', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.current_stage !== 'CERTIFICATION') {
      return res.status(400).json({ error: 'User is not currently in the CERTIFICATION stage.' });
    }

    await db.run('UPDATE user_progress SET certified = true, partner_activated = true WHERE user_id = ?', [userId]);
    await db.run("UPDATE users SET current_stage = 'PARTNER', role = 'PARTNER' WHERE id = ?", [userId]);

    const cleanName = user.name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
    const referralCode = `${cleanName}${String(userId).padStart(3, '0')}`;
    const referralLink = `center.lifebydesign.com/ref/${referralCode}`;

    if (user.referred_by) {
      const dbReferrer = await db.get('SELECT id FROM users WHERE email = ?', [user.referred_by]);
      if (dbReferrer) {
        const parentReferral = await db.get('SELECT id FROM referrals WHERE student_id = ?', [dbReferrer.id]);
        await db.run(`
          INSERT INTO referrals (partner_id, student_id, referral_code, parent_referral_id) 
          VALUES (?, ?, ?, ?)`,
          [dbReferrer.id, userId, referralCode, parentReferral ? parentReferral.id : null]
        );
      }
    }

    await db.logAudit(1, 'UserCertified', 'users', userId, { current_stage: 'CERTIFICATION', role: user.role }, { current_stage: 'PARTNER', role: 'PARTNER' });
    await db.logEvent('PartnerActivated', { userId, name: user.name, referralCode, referralLink });

    res.json({
      success: true,
      message: 'User certified and activated as a Life Design Partner.',
      referralCode,
      referralLink
    });

  } catch (err) {
    console.error('Certify partner error:', err);
    res.status(500).json({ error: 'Failed to certify partner.' });
  }
});

/* ==========================================================================
   LBDA PAYMENT & INVOICE ENGINE ENDPOINTS
   ========================================================================= */

const fs = require('fs');

// Helper to generate GST Tax Invoice & Receipt
async function generateInvoicePDF(userId, paymentId, paymentType, amount) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  const batch = await db.get('SELECT * FROM batches WHERE id = ?', [user.batch_id]);
  
  const invoiceNum = `INV-${Date.now()}`;
  const receiptNum = `REC-${Date.now()}`;
  const dateStr = new Date().toLocaleDateString('en-IN');
  
  // GST Calculations (18% GST included: Subtotal = Amount / 1.18, SGST = 9%, CGST = 9%)
  const totalAmount = Number(amount);
  const subtotal = Number((totalAmount / 1.18).toFixed(2));
  const cgst = Number((subtotal * 0.09).toFixed(2));
  const sgst = Number((subtotal * 0.09).toFixed(2));
  
  const invoiceHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Tax Invoice - ${invoiceNum}</title>
    <style>
      body { font-family: monospace; padding: 30px; line-height: 1.6; color: #333; }
      .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
      .title { font-size: 24px; font-weight: bold; }
      .details { display: flex; justify-content: space-between; margin-bottom: 30px; }
      table { width: 100%; border-collapse: collapse; margin: 20px 0; }
      th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
      th { background-color: #f2f2f2; }
      .totals { text-align: right; margin-top: 20px; font-size: 14px; }
      .gst-info { font-size: 11px; color: #666; margin-top: 40px; border-top: 1px dashed #ccc; padding-top: 10px; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="title">GST TAX INVOICE</div>
      <div><strong>Life By Design Academy (LBDA)</strong></div>
      <div>GSTIN: 33AAAAA1111A1Z1</div>
    </div>
    <div class="details">
      <div>
        <strong>Invoice To:</strong><br>
        Name: ${user.name}<br>
        Email: ${user.email}<br>
        Phone: ${user.phone}<br>
        Batch: ${batch ? batch.name : 'N/A'}
      </div>
      <div>
        <strong>Invoice Details:</strong><br>
        Invoice No: ${invoiceNum}<br>
        Date: ${dateStr}<br>
        Payment ID: ${paymentId}<br>
        Status: <span style="color: green; font-weight: bold;">PAID</span>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Amount (INR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Academy Certification Training - ${paymentType === 'PAYMENT_1' ? 'First Installment (₹1,00,000)' : 'Second Installment (₹2,00,000)'}</td>
          <td>₹${subtotal}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div>Subtotal: ₹${subtotal}</div>
      <div>CGST (9%): ₹${cgst}</div>
      <div>SGST (9%): ₹${sgst}</div>
      <hr>
      <div style="font-size: 16px;"><strong>Total Paid: ₹${totalAmount.toLocaleString('en-IN')}</strong></div>
    </div>
    <div class="gst-info">
      Thank you for your payment. This is a computer-generated tax invoice. No signature required.
    </div>
  </body>
  </html>
  `;

  const receiptHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Receipt - ${receiptNum}</title>
    <style>
      body { font-family: monospace; padding: 30px; line-height: 1.6; color: #333; }
      .receipt-box { border: 2px dashed #28a745; padding: 30px; max-width: 500px; margin: 0 auto; background: #fff; }
      h2 { color: #28a745; margin-top: 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    </style>
  </head>
  <body>
    <div class="receipt-box">
      <h2>PAYMENT RECEIPT</h2>
      <p>Life By Design Academy (LBDA)</p>
      <hr>
      <table>
        <tr><td><strong>Receipt No:</strong></td><td>${receiptNum}</td></tr>
        <tr><td><strong>Date:</strong></td><td>${dateStr}</td></tr>
        <tr><td><strong>Received From:</strong></td><td>${user.name}</td></tr>
        <tr><td><strong>Payment For:</strong></td><td>${paymentType === 'PAYMENT_1' ? 'First Installment' : 'Second Installment'}</td></tr>
        <tr><td><strong>Amount Received:</strong></td><td>₹${totalAmount.toLocaleString('en-IN')}</td></tr>
        <tr><td><strong>Payment Gateway ID:</strong></td><td>${paymentId}</td></tr>
      </table>
      <p style="margin-top: 30px; color: #28a745; font-size: 14px; font-weight: bold;">Status: Successful</p>
    </div>
  </body>
  </html>
  `;

  // Save files locally (Supabase mock fallback)
  const invoicesDir = path.join(__dirname, 'public', 'storage', 'invoices');
  const receiptsDir = path.join(__dirname, 'public', 'storage', 'receipts');
  
  if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir, { recursive: true });
  if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
  
  const invoicePath = path.join(invoicesDir, `${invoiceNum}.html`);
  const receiptPath = path.join(receiptsDir, `${receiptNum}.html`);
  
  fs.writeFileSync(invoicePath, invoiceHtml);
  fs.writeFileSync(receiptPath, receiptHtml);
  
  const invoiceUrl = `/storage/invoices/${invoiceNum}.html`;
  const receiptUrl = `/storage/receipts/${receiptNum}.html`;
  
  return { invoiceUrl, receiptUrl };
}

// POST: Create Razorpay Order
app.post('/api/payment/create', async (req, res) => {
  const { userId, paymentType } = req.body;
  
  if (!userId || !paymentType) {
    return res.status(400).json({ error: 'User ID and payment type (PAYMENT_1 or PAYMENT_2) are required.' });
  }

  try {
    const user = await db.get(`
      SELECT u.*, b.masterclass_date, b.gap_date
      FROM users u
      LEFT JOIN batches b ON u.batch_id = b.id
      WHERE u.id = ?
    `, [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let allowed = false;
    if (user.current_stage === paymentType) {
      allowed = true;
    } else if (user.current_stage === 'GAP' && paymentType === 'PAYMENT_1') {
      const gating = await resolveUserGating(user);
      if (gating.gapPaymentActive) {
        allowed = true;
      }
    }

    if (!allowed) {
      return res.status(400).json({ 
        error: `Cannot pay for ${paymentType}. User is currently at the ${user.current_stage} stage.` 
      });
    }

    // Determine amount (₹1,00,000 for PAYMENT_1, ₹2,00,000 for PAYMENT_2)
    const amount = paymentType === 'PAYMENT_1' ? 100000 : 200000;
    
    // Create Razorpay Order (Mock Order for local testing)
    const razorpayOrderId = `order_mock_${Date.now()}`;
    
    // Insert pending payment log
    const payResult = await db.run(`
      INSERT INTO payments (user_id, payment_type, amount, currency, razorpay_order_id, status)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, paymentType, amount, 'INR', razorpayOrderId, 'Pending']
    );

    await db.logEvent('PaymentInitiated', { userId, paymentType, amount, orderId: razorpayOrderId });

    res.json({
      success: true,
      paymentRecordId: payResult.id,
      orderId: razorpayOrderId,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'mock_key_id'
    });

  } catch (err) {
    console.error('Create payment order error:', err);
    res.status(500).json({ error: 'Failed to create payment order.' });
  }
});

// POST: Verify Razorpay Payment
app.post('/api/payment/verify', async (req, res) => {
  const { userId, paymentId, orderId, signature } = req.body;
  
  if (!userId || !paymentId || !orderId) {
    return res.status(400).json({ error: 'User ID, payment ID, and order ID are required.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const payment = await db.get(
      'SELECT * FROM payments WHERE user_id = ? AND razorpay_order_id = ? AND status = ?',
      [userId, orderId, 'Pending']
    );

    if (!payment) {
      return res.status(404).json({ error: 'Pending payment record not found.' });
    }

    // Simulate Signature Verification success
    const paymentType = payment.payment_type;
    const amount = payment.amount;

    // Generate Invoice and Receipt PDFs (HTML representations)
    const { invoiceUrl, receiptUrl } = await generateInvoicePDF(userId, paymentId, paymentType, amount);

    // Update payment record to success
    await db.run(`
      UPDATE payments 
      SET status = ?, razorpay_payment_id = ?, invoice_url = ?, receipt_url = ? 
      WHERE id = ?`,
      ['Success', paymentId, invoiceUrl, receiptUrl, payment.id]
    );

    // Advance Stage and update user progress
    let nextStage = '';
    if (paymentType === 'PAYMENT_1') {
      nextStage = 'BRIDGE';
      await db.run('UPDATE user_progress SET payment_1_completed = true WHERE user_id = ?', [userId]);
      await db.run('UPDATE users SET current_stage = ? WHERE id = ?', [nextStage, userId]);
      
      // Calculate direct referral commission if referred
      const referralRecord = await db.get('SELECT * FROM referrals WHERE student_id = ?', [userId]);
      if (referralRecord) {
        const referrer = await db.get('SELECT * FROM users WHERE id = ?', [referralRecord.partner_id]);
        
        // Commission only awarded to active partners (Stage = PARTNER or Role = PARTNER)
        if (referrer && (referrer.current_stage === 'PARTNER' || referrer.role === 'PARTNER')) {
          const rawCommission = await db.getSetting('commission_amount', '10000');
          const commissionAmount = parseFloat(rawCommission) || 10000;

          await db.run(`
            INSERT INTO earnings (partner_id, earning_type, amount, description)
            VALUES (?, ?, ?, ?)`,
            [referrer.id, 'REFERRAL', commissionAmount, `Direct referral commission for ${user.name} (Payment 1)`]
          );

          await db.logEvent('ReferralCommissionCredited', {
            partnerId: referrer.id,
            studentId: userId,
            amount: commissionAmount
          });
        }
      }

    } else if (paymentType === 'PAYMENT_2') {
      nextStage = 'CERTIFICATION';
      await db.run('UPDATE user_progress SET payment_2_completed = true WHERE user_id = ?', [userId]);
      await db.run('UPDATE users SET current_stage = ? WHERE id = ?', [nextStage, userId]);
    }

    await db.logAudit(1, 'PaymentCompleted', 'payments', payment.id, { status: 'Pending' }, { status: 'Success', invoice_url: invoiceUrl });
    await db.logEvent('PaymentSuccess', { userId, paymentType, amount, invoiceUrl });

    res.json({
      success: true,
      message: 'Payment verified and stage updated successfully.',
      nextStage,
      invoiceUrl,
      receiptUrl
    });

  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

/* ==========================================================================
   LBDA REFERRAL & COMMISSION ENGINE ENDPOINTS
   ========================================================================= */

// Recursive helper to build downline tree
async function getDownlineTree(userId) {
  const referrals = await db.all(
    'SELECT r.*, u.name, u.email, u.current_stage FROM referrals r JOIN users u ON r.student_id = u.id WHERE r.partner_id = ?',
    [userId]
  );
  const children = [];
  for (const ref of referrals) {
    const subTree = await getDownlineTree(ref.student_id);
    children.push({
      userId: ref.student_id,
      name: ref.name,
      email: ref.email,
      stage: ref.current_stage,
      referralCode: ref.referral_code,
      downline: subTree
    });
  }
  return children;
}

// GET: Retrieve referral tree and earnings stats
app.get('/api/referrals', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'User session not found.' });
    }

    let targetUserId = user.id;
    let viewAll = false;

    // MD or OPERATIONS role can bypass and view all trees or a specific user's tree
    if (['MD', 'OPERATIONS'].includes(user.role)) {
      if (req.query.view === 'all') {
        viewAll = true;
      } else if (req.query.userId) {
        targetUserId = parseInt(req.query.userId, 10);
      }
    }

    if (viewAll) {
      // Find all certified partners
      const partners = await db.all("SELECT id, name, email, current_stage FROM users WHERE role = 'PARTNER' OR current_stage = 'PARTNER'");
      const fullTree = [];
      for (const p of partners) {
        const downline = await getDownlineTree(p.id);
        fullTree.push({
          userId: p.id,
          name: p.name,
          email: p.email,
          stage: p.current_stage,
          downline
        });
      }
      return res.json({ success: true, tree: fullTree });
    }

    // Single Partner downline tree resolution
    const downline = await getDownlineTree(targetUserId);
    
    // Calculate stats
    const earnings = await db.all('SELECT * FROM earnings WHERE partner_id = ?', [targetUserId]);
    const totalReferralEarnings = earnings.filter(e => e.earning_type === 'REFERRAL').reduce((sum, e) => sum + e.amount, 0);
    const totalDeliveryEarnings = earnings.filter(e => e.earning_type === 'DELIVERY').reduce((sum, e) => sum + e.amount, 0);

    res.json({
      success: true,
      userId: targetUserId,
      name: user.name,
      downline,
      stats: {
        referralEarnings: totalReferralEarnings,
        deliveryEarnings: totalDeliveryEarnings,
        totalEarnings: totalReferralEarnings + totalDeliveryEarnings
      }
    });

  } catch (err) {
    console.error('Get referrals tree error:', err);
    res.status(500).json({ error: 'Failed to retrieve referrals tree.' });
  }
});

// POST: Admin records a coaching delivery participant (₹10,000 earining per student)
app.post('/api/admin/delivery/add', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { partnerId, participantName, participantEmail } = req.body;
  if (!partnerId || !participantName) {
    return res.status(400).json({ error: 'Partner ID and participant name are required.' });
  }

  try {
    const partner = await db.get('SELECT * FROM users WHERE id = ?', [partnerId]);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found.' });
    }

    const amount = 10000;
    const description = `Coaching delivery participant: ${participantName} (${participantEmail || 'No Email'})`;

    const result = await db.run(`
      INSERT INTO earnings (partner_id, earning_type, amount, description)
      VALUES (?, ?, ?, ?)`,
      [partnerId, 'DELIVERY', amount, description]
    );

    await db.logEvent('DeliveryEarningCredited', { partnerId, amount, participantName });
    await db.logAudit(1, 'AddDeliveryParticipant', 'earnings', result.id, null, { partner_id: partnerId, amount, description });

    res.json({
      success: true,
      message: `Delivery earning of ₹10,000 credited to partner ${partner.name}.`,
      earningId: result.id
    });

  } catch (err) {
    console.error('Add delivery participant error:', err);
    res.status(500).json({ error: 'Failed to add delivery participant.' });
  }
});

/* ==========================================================================
   LBDA NOTIFICATION ENGINE ENDPOINTS & BACKGROUND SCHEDULER
   ========================================================================= */

// Helper to check upcoming batch events and queue 1-day / 1-hour reminders
async function checkAndQueueReminders() {
  const now = new Date();
  const batches = await db.all('SELECT * FROM batches WHERE is_active = 1');
  
  for (const b of batches) {
    const events = [
      { date: b.masterclass_date, name: 'Masterclass' },
      { date: b.gap_date, name: 'Gap Session' },
      { date: b.bridge_date, name: 'Bridge Session' }
    ];

    for (const ev of events) {
      if (!ev.date) continue;
      
      const eventTime = new Date(ev.date).getTime();
      const diffMs = eventTime - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      let reminderLabel = null;
      if (diffHours > 23 && diffHours < 25) {
        reminderLabel = '1 Day Before';
      } else if (diffHours > 0.8 && diffHours < 1.2) {
        reminderLabel = '1 Hour Before';
      }

      if (reminderLabel) {
        const users = await db.all('SELECT * FROM users WHERE batch_id = ? AND is_active = 1', [b.id]);
        for (const u of users) {
          const subject = `${ev.name} Reminder: ${reminderLabel}`;
          // Check if already queued to prevent duplication
          const existing = await db.get(
            'SELECT id FROM notifications WHERE user_id = ? AND subject = ?',
            [u.id, subject]
          );
          if (!existing) {
            await db.run(`
              INSERT INTO notifications (user_id, channel, subject, message, status, scheduled_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
              [u.id, 'EMAIL', subject, `Friendly reminder: Your ${ev.name} is scheduled in ${reminderLabel}!`, 'PENDING', now.toISOString()]
            );
            console.log(`[REMINDER SCHEDULER] Queued: ${subject} for ${u.email}`);
          }
        }
      }
    }
  }
}

// POST: Broadcast notifications (Single User, Batch, or All Users)
app.post('/api/admin/send-notification', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  const { userId, batchId, target, channel, subject, message, sendNow } = req.body;
  if (!channel || !message || !target) {
    return res.status(400).json({ error: 'Target, channel, and message are required.' });
  }

  try {
    let targetUsers = [];
    
    if (target === 'single' && userId) {
      const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (user) targetUsers.push(user);
    } else if (target === 'batch' && batchId) {
      const users = await db.all('SELECT * FROM users WHERE batch_id = ?', [batchId]);
      targetUsers = users;
    } else if (target === 'all') {
      const users = await db.all('SELECT * FROM users');
      targetUsers = users;
    }

    if (targetUsers.length === 0) {
      return res.status(404).json({ error: 'No target users found for this broadcast.' });
    }

    const status = sendNow ? 'SENT' : 'PENDING';
    const sentAt = sendNow ? new Date().toISOString() : null;
    const scheduledAt = sendNow ? new Date().toISOString() : new Date(Date.now() + 60000).toISOString();

    for (const u of targetUsers) {
      await db.run(`
        INSERT INTO notifications (user_id, channel, subject, message, status, scheduled_at, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.id, channel.toUpperCase(), subject || null, message, status, scheduledAt, sentAt]
      );
    }

    await db.logEvent('NotificationBroadcast', { channel, target, count: targetUsers.length });

    res.json({
      success: true,
      message: `Notifications successfully sent/queued to ${targetUsers.length} users.`
    });

  } catch (err) {
    console.error('Broadcast notification error:', err);
    res.status(500).json({ error: 'Failed to broadcast notification.' });
  }
});

// POST: Trigger manual scan for upcoming event reminders (Developer utility)
app.post('/api/admin/notifications/check-reminders', requireAuth, requireRole(['MD', 'OPERATIONS']), async (req, res) => {
  try {
    await checkAndQueueReminders();
    res.json({ success: true, message: 'Upcoming reminders scanned and queued.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger reminders check.', details: err.message });
  }
});

// Start scheduler background loop in module context
if (require.main === module) {
  setInterval(() => {
    checkAndQueueReminders().catch(err => console.error('Background reminder scheduler error:', err));
  }, 5 * 60 * 1000);
}

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
