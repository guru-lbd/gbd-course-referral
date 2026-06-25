/* ==========================================================================
   GBD AFFILIATE SYSTEM - SERVERLESS FRONTEND ENGINE (V4)
   ========================================================================== */

// Detect Page Context
const isClientPage = !!document.getElementById('auth-panel');
const isAdminPage = !!document.getElementById('admin-affiliates-tbody');

// App Variables
let users = [];
let referralProfiles = [];
let clicks = [];
let signups = [];
let eventLogs = [];
let currentUser = null;
let cart = [];
let activeTab = 'referral';
let authMode = 'login'; // 'login' or 'register'
let editingClientEmail = null;
let editingAffiliateCode = null;
let allSignups = [];
let allBatches = [];
let referrals = [];
let transformState = { x: 0, y: 0, scale: 0.85 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let collapsedNodes = new Set(); // To track collapsed node codes
let systemSettings = {
  friend_discount_enabled: true,
  friend_discount_percent: 10,
  commission_enabled: true,
  commission_amount: 20.00
};

// Database Seeds (Seeded on first load if localStorage is empty)
// Separation of sign up (user accounts) and referral data.
// All databases are initialized 100% empty at start.
const SEED_USERS = [];
const SEED_REFERRALS = [];
const SEED_CLICKS = [];
const SEED_SIGNUPS = [];

function resolveClientPortalView() {
  if (!currentUser) {
    document.getElementById('auth-panel').style.display = 'block';
    document.getElementById('portal-panel').style.display = 'none';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
    return;
  }

  document.getElementById('auth-panel').style.display = 'none';
  document.getElementById('welcome-message').textContent = `Logged in as: ${currentUser.name}`;

  const stage = currentUser.current_stage || 'INVITED';

  if (stage === 'GAP' || stage === 'PAYMENT_1') {
    document.getElementById('gap-details-panel').style.display = 'flex';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('portal-panel').style.display = 'none';
    renderCourseDetailsPageProgress();
  } else if (currentUser.gap_page_active && ['INVITED', 'MASTERCLASS', 'REGISTRATION'].includes(stage)) {
    document.getElementById('gap-details-panel').style.display = 'flex';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('portal-panel').style.display = 'none';
    renderCourseDetailsPageProgress();
  } else if (stage === 'INVITED' || stage === 'MASTERCLASS') {
    document.getElementById('migration-landing-panel').style.display = 'flex';
    document.getElementById('portal-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
    
    // Reset button text in case it was modified
    const reserveBtn = document.querySelector('.btn-reserve-seat span');
    if (reserveBtn) reserveBtn.textContent = 'RESERVE MY SEAT';
  } else if (stage === 'REGISTRATION') {
    // Gap page deactivated: show migration page with a banner
    document.getElementById('migration-landing-panel').style.display = 'flex';
    document.getElementById('portal-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
    
    // Update button text to reflect attendance verified
    const reserveBtn = document.querySelector('.btn-reserve-seat span');
    if (reserveBtn) reserveBtn.textContent = 'VIEW ATTENDANCE STATUS';
    
    // Hide dashboard bypass button inside popup card if registration is locked
    const bypassBtn = document.querySelector('#masterclass-popup button[onclick="proceedToDashboard()"]');
    if (bypassBtn) bypassBtn.style.display = 'none';
    
    showNotification('Access to the Gap details page is pending activation by Admin.', 'info');
  } else {
    document.getElementById('portal-panel').style.display = 'block';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
  }
}

function renderCourseDetailsPageProgress() {
  if (!currentUser) return;
  const stage = currentUser.current_stage || 'INVITED';
  
  const gapGrid = document.getElementById('gap-courses-grid');
  if (!gapGrid) return;
  
  const gapCard = gapGrid.querySelector('.unlocked');
  const gapBtn = gapCard ? gapCard.querySelector('button') : null;
  const floatingWidget = document.getElementById('floating-payment-widget');
  
  const showFloatingWidget = (stage === 'PAYMENT_1') || (stage === 'GAP' && currentUser.gap_payment_active);

  if (stage === 'GAP') {
    if (gapBtn) {
      gapBtn.textContent = '✓ Registered';
      gapBtn.disabled = true;
      gapBtn.style.background = 'rgba(255, 255, 255, 0.05)';
      gapBtn.style.color = 'var(--text-muted)';
      gapBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      gapBtn.style.boxShadow = 'none';
      gapBtn.style.cursor = 'default';
    }
  } else if (stage === 'PAYMENT_1' || stage === 'BRIDGE' || stage === 'PAYMENT_2' || stage === 'CERTIFIED' || stage === 'PARTNER') {
    if (gapBtn) {
      gapBtn.textContent = '✓ Completed';
      gapBtn.disabled = true;
      gapBtn.style.background = 'rgba(255, 255, 255, 0.05)';
      gapBtn.style.color = 'var(--text-muted)';
      gapBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      gapBtn.style.boxShadow = 'none';
      gapBtn.style.cursor = 'default';
    }
  } else {
    if (gapBtn) {
      gapBtn.textContent = 'Register for Gap';
      gapBtn.disabled = false;
      gapBtn.style.background = 'linear-gradient(135deg, #E2B774 0%, #C6A268 100%)';
      gapBtn.style.color = '#121212';
      gapBtn.style.border = 'none';
      gapBtn.style.boxShadow = '0 4px 15px rgba(198,162,104,0.2)';
      gapBtn.style.cursor = 'pointer';
    }
  }

  if (floatingWidget) {
    if (showFloatingWidget && (stage === 'GAP' || stage === 'PAYMENT_1')) {
      floatingWidget.style.display = 'flex';
    } else {
      floatingWidget.style.display = 'none';
    }
  }
}

function closeFloatingPaymentWidget() {
  const widget = document.getElementById('floating-payment-widget');
  if (widget) widget.style.display = 'none';
}

async function initiateFloatingPayment() {
  if (!currentUser) return;
  
  const paymentType = currentUser.current_stage === 'GAP' ? 'PAYMENT_1' : (currentUser.current_stage || 'PAYMENT_1');
  showNotification('Initiating payment transaction...', 'info');
  
  try {
    const createRes = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, paymentType })
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error || 'Failed to create payment order');
    
    const verifyRes = await fetch('/api/payment/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        paymentId: `pay_mock_${Date.now()}`,
        orderId: createData.payment.razorpay_order_id,
        signature: `sig_mock_${Date.now()}`
      })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verifyData.error || 'Failed to verify payment');
    
    showNotification('Payment successful! Stage updated to ' + verifyData.nextStage, 'success');
    
    currentUser.current_stage = verifyData.nextStage;
    localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
    
    const floatingCard = document.getElementById('floating-payment-widget');
    if (floatingCard) floatingCard.style.display = 'none';
    
    resolveClientPortalView();
  } catch (err) {
    console.error('Payment execution failed:', err);
    showNotification(err.message || 'Payment failed. Please try again.', 'error');
  }
}

function showOptimisticClientPortal() {
  const session = localStorage.getItem('gbd_current_user');
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');

  if (session) {
    try {
      currentUser = JSON.parse(session);
      if (currentUser && currentUser.name) {
        resolveClientPortalView();
        
        // Render initial UI using cached session details
        renderCoursesCatalog();
        renderProfile();
        
        // Render cart count
        const cartCountEl = document.getElementById('cart-count');
        if (cartCountEl) cartCountEl.textContent = cart.length;
        
        // Show the active tab (usually courses)
        switchTab(activeTab);
      } else {
        document.getElementById('auth-panel').style.display = 'block';
        document.getElementById('portal-panel').style.display = 'none';
        document.getElementById('migration-landing-panel').style.display = 'none';
        document.getElementById('gap-details-panel').style.display = 'none';
        resetOtpRequest();
      }
    } catch (e) {
      console.warn('Optimistic client portal parse error:', e);
      document.getElementById('auth-panel').style.display = 'block';
      document.getElementById('portal-panel').style.display = 'none';
      document.getElementById('migration-landing-panel').style.display = 'none';
      document.getElementById('gap-details-panel').style.display = 'none';
      resetOtpRequest();
    }
  } else {
    document.getElementById('auth-panel').style.display = 'block';
    document.getElementById('portal-panel').style.display = 'none';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
    resetOtpRequest();
  }
}

// Manually enter portal from loading page
function enterPortal() {
  const loader = document.getElementById('loading-screen');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => {
      loader.style.display = 'none';
    }, 800); // Allow fade animation to finish
  }
}

// Initialize Database and handle async startup
document.addEventListener('DOMContentLoaded', async () => {
  if (isClientPage) {
    showOptimisticClientPortal();
  }
  await initDatabase();
  if (isClientPage) {
    initClientPortal();
  } else if (isAdminPage) {
    initAdminPortal();
  }
});

/* ==========================================================================
   DATABASE / LOCAL STORAGE MANAGER
   ========================================================================== */

let useBackend = false;

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

// Client-side mock user gating resolver for Local Simulation Mode
function resolveMockUserGating(user) {
  if (!user) return { gapPageActive: false, gapPaymentActive: false };
  const batchId = user.batch_id || 1;
  const settings = JSON.parse(localStorage.getItem('gbd_settings_v4')) || {};
  const batches = JSON.parse(localStorage.getItem('gbd_batches_v4')) || [
    { id: 1, name: 'Old Big Sister', code: 'OLD_BIG_SISTER', masterclass_date: '2026-06-20T19:00', registration_date: '2026-06-21T19:00', gap_date: '2026-06-22T19:00', bridge_date: '2026-06-24T19:00' },
    { id: 2, name: 'New Big Sister', code: 'NEW_BIG_SISTER', masterclass_date: '2026-06-22T19:00', registration_date: '2026-06-23T19:00', gap_date: '2026-06-24T19:00', bridge_date: '2026-06-26T19:00' },
    { id: 3, name: 'SS Certified', code: 'SS_CERTIFIED', masterclass_date: '2026-06-24T19:00', registration_date: '2026-06-25T19:00', gap_date: '2026-06-26T19:00', bridge_date: '2026-06-28T19:00' }
  ];
  const batch = batches.find(b => b.id === batchId);

  const manualGapActive = settings[`gap_page_active_${batchId}`] !== false;
  const manualPaymentActive = settings[`gap_payment_active_${batchId}`] === true;

  const currentTime = new Date();
  let isMasterclassPassed = false;
  if (batch && batch.masterclass_date) {
    const masterclassTime = parseLocalDate(batch.masterclass_date);
    isMasterclassPassed = !isNaN(masterclassTime.getTime()) && currentTime >= masterclassTime;
  }

  let isGapPassed = false;
  if (batch && batch.gap_date) {
    const gapTime = parseLocalDate(batch.gap_date);
    isGapPassed = !isNaN(gapTime.getTime()) && currentTime >= gapTime;
  }

  return {
    gapPageActive: manualGapActive || isMasterclassPassed,
    gapPaymentActive: manualPaymentActive || isGapPassed
  };
}

async function initDatabase() {
  try {
    const configRes = await fetch('/api/config');
    if (!configRes.ok) throw new Error('Config request failed');
    const configData = await configRes.json();
    useBackend = !!configData.persistentBackend;
    
    // Parse system settings from config payload directly
    systemSettings = {
      friend_discount_enabled: configData.friendDiscountEnabled,
      friend_discount_percent: configData.friendDiscountPercent,
      commission_enabled: configData.commissionEnabled,
      commission_amount: configData.commissionAmount
    };
    
    if (useBackend) {
      if (isAdminPage) {
        // Fetch admin data and settings in parallel
        const [dataRes, settingsRes] = await Promise.all([
          fetch('/api/admin/data'),
          fetch('/api/admin/settings')
        ]);
        
        if (!dataRes.ok) throw new Error('Admin data request failed');
        const data = await dataRes.json();
        
        users = data.users || [];
        referralProfiles = data.affiliates || [];
        clicks = data.clicks || [];
        signups = data.signups || [];
        eventLogs = data.events || [];
        allSignups = data.allSignups || [];
        
        if (settingsRes.ok) {
          systemSettings = await settingsRes.json();
        }
      } else if (isClientPage) {
        // Fetch current user details if logged in
        const session = localStorage.getItem('gbd_current_user');
        if (session) {
          const cachedUser = JSON.parse(session);
          const userRes = await fetch(`/api/users/me?email=${encodeURIComponent(cachedUser.email)}`);
          if (userRes.ok) {
            const userData = await userRes.json();
            currentUser = userData.user;
            currentUser.affiliate = userData.affiliate;
            localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
            resolveClientPortalView();
          } else if (userRes.status === 401 || userRes.status === 404) {
            try {
              const errData = await userRes.json();
              if (errData && (errData.error === 'User not found.' || errData.error === 'Unauthorized.')) {
                localStorage.removeItem('gbd_current_user');
                currentUser = null;
                if (isClientPage) {
                  document.getElementById('portal-panel').style.display = 'none';
                  document.getElementById('auth-panel').style.display = 'block';
                  toggleAuthMode('login');
                  showNotification('Your session has expired. Please log in again.', 'error');
                }
              }
            } catch (jsonErr) {
              console.warn('Non-JSON error response from users/me, skipping logout.');
            }
          }
        }
      }
      
      console.log('Synchronized database with persistent backend server.');
      return;
    }
  } catch (err) {
    console.warn('Backend server check failed. Falling back to browser LocalStorage:', err.message);
  }
  
  useBackend = false;
  
  // Check if database exists in localStorage, else write seed data
  if (!localStorage.getItem('gbd_users_v4')) {
    localStorage.setItem('gbd_users_v4', JSON.stringify(SEED_USERS));
  }
  if (!localStorage.getItem('gbd_referrals_v4')) {
    localStorage.setItem('gbd_referrals_v4', JSON.stringify(SEED_REFERRALS));
  }
  if (!localStorage.getItem('gbd_clicks_v4')) {
    localStorage.setItem('gbd_clicks_v4', JSON.stringify(SEED_CLICKS));
  }
  if (!localStorage.getItem('gbd_signups_v4')) {
    localStorage.setItem('gbd_signups_v4', JSON.stringify(SEED_SIGNUPS));
  }
  if (!localStorage.getItem('gbd_events_v4')) {
    const initialEvents = [
      { id: 1, event_type: 'DatabaseSeeded', payload: JSON.stringify({ users: 0, referrals: 0 }), created_at: new Date().toISOString() }
    ];
    localStorage.setItem('gbd_events_v4', JSON.stringify(initialEvents));
  }
  if (!localStorage.getItem('gbd_settings_v4')) {
    localStorage.setItem('gbd_settings_v4', JSON.stringify({
      friend_discount_enabled: true,
      friend_discount_percent: 10,
      commission_enabled: true,
      commission_amount: 20.00
    }));
  }

  // Load database arrays into memory
  users = JSON.parse(localStorage.getItem('gbd_users_v4')) || [];
  referralProfiles = JSON.parse(localStorage.getItem('gbd_referrals_v4')) || [];
  clicks = JSON.parse(localStorage.getItem('gbd_clicks_v4')) || [];
  signups = JSON.parse(localStorage.getItem('gbd_signups_v4')) || [];
  eventLogs = JSON.parse(localStorage.getItem('gbd_events_v4')) || [];
  systemSettings = JSON.parse(localStorage.getItem('gbd_settings_v4')) || systemSettings;

  // Show offline warning banner if using localStorage fallback
  if (!useBackend) {
    const bannerId = 'offline-mode-warning-banner';
    if (!document.getElementById(bannerId)) {
      const banner = document.createElement('div');
      banner.id = bannerId;
      banner.style.cssText = "background: rgba(192, 57, 43, 0.15); border-bottom: 1.5px solid var(--danger); color: var(--danger); text-align: center; padding: 0.6rem; font-size: 0.8rem; font-weight: bold; width: 100%; position: relative; z-index: 100000; font-family: var(--font-sans);";
      banner.innerHTML = "⚠️ Running in Local Simulation Mode (Offline Fallback). Data is stored locally in this browser and cannot be shared across different browsers, private tabs, or devices.";
      document.body.insertBefore(banner, document.body.firstChild);
    }

    if (currentUser) {
      const mockGating = resolveMockUserGating(currentUser);
      currentUser.gap_page_active = mockGating.gapPageActive;
      currentUser.gap_payment_active = mockGating.gapPaymentActive;
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      resolveClientPortalView();
    }
  }
}

// Write arrays back to localStorage
function saveDatabase() {
  localStorage.setItem('gbd_users_v4', JSON.stringify(users));
  localStorage.setItem('gbd_referrals_v4', JSON.stringify(referralProfiles));
  localStorage.setItem('gbd_clicks_v4', JSON.stringify(clicks));
  localStorage.setItem('gbd_signups_v4', JSON.stringify(signups));
  localStorage.setItem('gbd_events_v4', JSON.stringify(eventLogs));
  localStorage.setItem('gbd_settings_v4', JSON.stringify(systemSettings));
}

// Helper to log audit events programmatically
function logSystemEvent(eventType, payload) {
  const eventId = eventLogs.length > 0 ? eventLogs[eventLogs.length - 1].id + 1 : 1;
  const newEvent = {
    id: eventId,
    event_type: eventType,
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString()
  };
  eventLogs.push(newEvent);
  saveDatabase();
  console.log(`[EVENT] ${eventType}:`, payload);
  if (isAdminPage) {
    renderEventsConsole(eventLogs);
  }
}

function getOrCreateReferralProfile(email, name) {
  if (useBackend && currentUser && currentUser.email === email && currentUser.affiliate) {
    return {
      email: currentUser.email,
      affiliate_code: currentUser.affiliate.affiliate_code,
      coupon_code: currentUser.affiliate.coupon_code,
      referrals_count: currentUser.affiliate.total_signups,
      earnings: currentUser.affiliate.total_commission,
      total_signups: currentUser.affiliate.total_signups,
      total_commission: currentUser.affiliate.total_commission
    };
  }
  
  let profile = referralProfiles.find(r => r.email === email);
  if (!profile) {
    const cleanName = name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const affiliateCode = `${cleanName}${randNum}`;
    const couponCode = `${affiliateCode}-OFF`;
    
    profile = {
      email: email,
      affiliate_code: affiliateCode,
      coupon_code: couponCode,
      referrals_count: 0,
      earnings: 0.00
    };
    referralProfiles.push(profile);
    saveDatabase();
    
    logSystemEvent('ReferralProfileCreated', {
      email: email,
      affiliate_code: affiliateCode,
      coupon_code: couponCode
    });
  }
  return profile;
}

// Dynamically resolve and display referral banner in Cart Page
async function updateReferredBanner() {
  const banner = document.getElementById('referred-banner');
  const bannerText = document.getElementById('referred-banner-text');
  if (!banner || !bannerText) return;

  // 1. Check if logged in user has a referrer bind on their profile
  if (currentUser && currentUser.referred_by) {
    const referrerEmail = currentUser.referred_by.trim().toLowerCase();
    
    if (useBackend) {
      try {
        const res = await fetch(`/api/referrals/lookup?code=${encodeURIComponent(referrerEmail)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.name && data.coupon_code) {
            localStorage.setItem('gbd_active_referral', data.affiliate_code);
            localStorage.setItem('gbd_active_referrer_name', data.name);
            localStorage.setItem('gbd_active_coupon_code', data.coupon_code);
            
            banner.style.display = 'block';
            bannerText.innerHTML = `You were referred by <strong>${data.name}</strong>. Apply their coupon code <code>${data.coupon_code}</code> at checkout to save 10%!`;
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch referrer details:', err);
      }
    } else {
      // Local storage simulation mode
      const referrerProfile = referralProfiles.find(r => r.email.toLowerCase() === referrerEmail);
      if (referrerProfile) {
        const referrerUser = users.find(u => u.email.toLowerCase() === referrerEmail);
        const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
        
        localStorage.setItem('gbd_active_referral', referrerProfile.affiliate_code);
        localStorage.setItem('gbd_active_referrer_name', referrerName);
        localStorage.setItem('gbd_active_coupon_code', referrerProfile.coupon_code);
        
        banner.style.display = 'block';
        bannerText.innerHTML = `You were referred by <strong>${referrerName}</strong>. Apply their coupon code <code>${referrerProfile.coupon_code}</code> at checkout to save 10%!`;
        return;
      }
    }
  }

  // 2. Fallback: Check if there is an active session/manually applied coupon in localStorage
  const activeRef = localStorage.getItem('gbd_active_referral');
  const cachedName = localStorage.getItem('gbd_active_referrer_name');
  const cachedCoupon = localStorage.getItem('gbd_active_coupon_code');

  if (activeRef && cachedName && cachedName !== 'undefined' && cachedCoupon && cachedCoupon !== 'undefined') {
    banner.style.display = 'block';
    bannerText.innerHTML = `You were referred by <strong>${cachedName}</strong>. Apply their coupon code <code>${cachedCoupon}</code> at checkout to save 10%!`;
  } else if (activeRef) {
    if (useBackend) {
      try {
        const res = await fetch(`/api/referrals/lookup?code=${encodeURIComponent(activeRef)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.name && data.coupon_code) {
            localStorage.setItem('gbd_active_referrer_name', data.name);
            localStorage.setItem('gbd_active_coupon_code', data.coupon_code);
            banner.style.display = 'block';
            bannerText.innerHTML = `You were referred by <strong>${data.name}</strong>. Apply their coupon code <code>${data.coupon_code}</code> at checkout to save 10%!`;
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to lookup active referral:', err);
      }
    } else {
      const referrerProfile = referralProfiles.find(r => r.affiliate_code === activeRef);
      if (referrerProfile) {
        const referrerUser = users.find(u => u.email === referrerProfile.email);
        const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
        banner.style.display = 'block';
        bannerText.innerHTML = `You were referred by <strong>${referrerName}</strong>. Apply their coupon code <code>${referrerProfile.coupon_code}</code> at checkout to save 10%!`;
        return;
      }
    }
    banner.style.display = 'none';
  } else {
    banner.style.display = 'none';
  }
}

/* ==========================================================================
   CLIENT PORTAL CONTROLLER (index.html)
   ========================================================================== */

function initClientPortal() {
  // 1. Check if visited via referral query parameters (e.g. ?ref=ALEX55)
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');

  if (refCode) {
    if (useBackend) {
      // Save referral to browser session cookie/localstorage
      localStorage.setItem('gbd_active_referral', refCode.toUpperCase());
      
      // Log Click Event via API
      fetch('/api/clicks/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliateCode: refCode.toUpperCase(),
          ip: 'Simulated Visitor'
        })
      })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          // Cache name and coupon in localStorage
          if (data.referrerName && data.referrerName !== 'undefined') {
            localStorage.setItem('gbd_active_referrer_name', data.referrerName);
          }
          if (data.couponCode && data.couponCode !== 'undefined') {
            localStorage.setItem('gbd_active_coupon_code', data.couponCode);
          }
          updateReferredBanner();
        }
      })
      .catch(err => console.warn('Click log API failed:', err));

      // Clean query params from URL bar
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const cleanCode = refCode.toUpperCase().replace(/-OFF$/, '');
      const referrerProfile = referralProfiles.find(r => r.affiliate_code === cleanCode);
      if (referrerProfile) {
        const referrerUser = users.find(u => u.email === referrerProfile.email);
        const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
        
        // Save referral to browser session cookie/localstorage
        localStorage.setItem('gbd_active_referral', referrerProfile.affiliate_code);
        localStorage.setItem('gbd_active_referrer_name', referrerName);
        localStorage.setItem('gbd_active_coupon_code', referrerProfile.coupon_code);
        
        const click = {
          affiliate_code: referrerProfile.affiliate_code,
          affiliate_name: referrerName,
          ip: 'Simulated Visitor',
          created_at: new Date().toISOString()
        };
        clicks.push(click);
        saveDatabase();
        
        logSystemEvent('ClickCreated', {
          affiliate_code: referrerProfile.affiliate_code,
          affiliate_name: referrerName,
          ip: 'Simulated Visitor'
        });

        updateReferredBanner();
        
        // Clean query params from URL bar
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  } else {
    // Check if there is an active referral cookie in storage
    const activeRef = localStorage.getItem('gbd_active_referral');
    if (activeRef) {
      updateReferredBanner();
    }
  }

  // 2. Check Login Session
  const session = localStorage.getItem('gbd_current_user');
  if (session) {
    currentUser = JSON.parse(session);
    if (!useBackend) {
      const freshUser = users.find(u => u.email === currentUser.email);
      if (freshUser) currentUser = freshUser;
    }
    
    resolveClientPortalView();
    switchTab('referral');
  } else {
    document.getElementById('auth-panel').style.display = 'block';
    document.getElementById('portal-panel').style.display = 'none';
    document.getElementById('migration-landing-panel').style.display = 'none';
    document.getElementById('gap-details-panel').style.display = 'none';
    resetOtpRequest();
  }

  // Periodic polling for status updates while waiting for stage/Gap activation
  if (isClientPage) {
    if (window.clientPortalPollInterval) {
      clearInterval(window.clientPortalPollInterval);
    }
    window.clientPortalPollInterval = setInterval(async () => {
      if (currentUser && currentUser.email) {
        const stage = currentUser.current_stage || 'INVITED';
        if (stage === 'INVITED' || stage === 'MASTERCLASS' || (stage === 'REGISTRATION' && !currentUser.gap_page_active) || (stage === 'GAP' && !currentUser.gap_payment_active)) {
          if (useBackend) {
            try {
              const userRes = await fetch(`/api/users/me?email=${encodeURIComponent(currentUser.email)}`);
              if (userRes.ok) {
                const userData = await userRes.json();
                const oldStage = currentUser.current_stage;
                const oldGapActive = currentUser.gap_page_active;
                const oldGapPaymentActive = currentUser.gap_payment_active;
                
                currentUser = userData.user;
                currentUser.affiliate = userData.affiliate;
                localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
                
                if (currentUser.current_stage !== oldStage || 
                    currentUser.gap_page_active !== oldGapActive || 
                    currentUser.gap_payment_active !== oldGapPaymentActive) {
                  resolveClientPortalView();
                  // If a masterclass popup status update is needed
                  const popup = document.getElementById('masterclass-popup');
                  if (popup && popup.style.display === 'flex') {
                    showMasterclassPopup();
                  }
                }
              } else if (userRes.status === 401 || userRes.status === 404) {
                clearInterval(window.clientPortalPollInterval);
                localStorage.removeItem('gbd_current_user');
                currentUser = null;
                if (isClientPage) {
                  document.getElementById('portal-panel').style.display = 'none';
                  document.getElementById('gap-details-panel').style.display = 'none';
                  document.getElementById('migration-landing-panel').style.display = 'none';
                  document.getElementById('auth-panel').style.display = 'block';
                  toggleAuthMode('login');
                  showNotification('Your session has expired. Please log in again.', 'error');
                }
              }
            } catch (err) {
              console.warn('Status polling error:', err);
            }
          } else {
            // Local Simulation Mode fallback
            const oldGapActive = currentUser.gap_page_active;
            const oldGapPaymentActive = currentUser.gap_payment_active;
            
            const mockGating = resolveMockUserGating(currentUser);
            
            if (mockGating.gapPageActive !== oldGapActive || mockGating.gapPaymentActive !== oldGapPaymentActive) {
              currentUser.gap_page_active = mockGating.gapPageActive;
              currentUser.gap_payment_active = mockGating.gapPaymentActive;
              localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
              resolveClientPortalView();
            }
          }
        }
      }
    }, 4000);
  }
}

// Toggle password input visibility on login/register screen
function togglePasswordVisibility() {
  const pwdInput = document.getElementById('auth-password');
  const btn = document.getElementById('password-toggle-btn');
  if (pwdInput && btn) {
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 1.25rem; height: 1.25rem;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>`;
    } else {
      pwdInput.type = 'password';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 1.25rem; height: 1.25rem;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>`;
    }
  }
}

// Display custom non-blocking notification toast
function showNotification(message, type = 'success') {
  let banner = document.getElementById('notification-banner');
  let msgEl = document.getElementById('notification-message');
  let iconEl = document.getElementById('notification-icon');
  
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'notification-banner';
    banner.className = 'panel';
    banner.style.display = 'none';
    banner.style.padding = '1rem 1.5rem';
    banner.style.border = '1px solid var(--border-color)';
    banner.style.borderRadius = '8px';
    banner.style.fontWeight = '500';
    banner.style.fontFamily = 'var(--font-sans)';
    banner.style.transition = 'all 0.3s ease';
    banner.style.opacity = '0';
    banner.style.alignItems = 'center';
    banner.style.gap = '0.75rem';
    
    iconEl = document.createElement('span');
    iconEl.id = 'notification-icon';
    iconEl.style.fontSize = '1.2rem';
    
    msgEl = document.createElement('span');
    msgEl.id = 'notification-message';
    
    banner.appendChild(iconEl);
    banner.appendChild(msgEl);
    document.body.appendChild(banner);
  }
  
  if (type === 'success') {
    iconEl.textContent = '✓';
    banner.style.backgroundColor = 'rgba(79, 90, 69, 0.05)';
    banner.style.borderColor = 'rgba(79, 90, 69, 0.25)';
    banner.style.color = 'var(--success)';
  } else if (type === 'error') {
    iconEl.textContent = '⚠️';
    banner.style.backgroundColor = 'rgba(163, 40, 40, 0.05)';
    banner.style.borderColor = 'rgba(163, 40, 40, 0.25)';
    banner.style.color = 'var(--danger)';
  } else {
    iconEl.textContent = 'ℹ️';
    banner.style.backgroundColor = 'rgba(198, 162, 104, 0.05)';
    banner.style.borderColor = 'rgba(198, 162, 104, 0.25)';
    banner.style.color = 'var(--secondary)';
  }
  
  msgEl.textContent = message;
  banner.style.display = 'flex';
  
  // Force a browser reflow to trigger CSS transitions smoothly
  banner.offsetHeight; 
  banner.style.opacity = '1';
  
  if (window.notificationTimeout) {
    clearTimeout(window.notificationTimeout);
  }
  
  window.notificationTimeout = setTimeout(() => {
    banner.style.opacity = '0';
    setTimeout(() => {
      banner.style.display = 'none';
    }, 300);
  }, 4000);
}

// Display custom modal confirmation dialog within LIFE DESIGN brand guidelines
function showCustomModal({ title = 'Confirm Action', message, type = 'confirm', variant = 'danger', onConfirm }) {
  const modal = document.getElementById('custom-modal');
  const titleEl = document.getElementById('custom-modal-title');
  const msgEl = document.getElementById('custom-modal-message');
  const cancelBtn = document.getElementById('custom-modal-cancel-btn');
  const confirmBtn = document.getElementById('custom-modal-confirm-btn');
  
  if (!modal || !titleEl || !msgEl || !cancelBtn || !confirmBtn) {
    // Fallback if elements do not exist (e.g. client page)
    if (type === 'confirm') {
      if (confirm(message) && onConfirm) onConfirm();
    } else {
      alert(message);
      if (onConfirm) onConfirm();
    }
    return;
  }
  
  titleEl.textContent = title;
  msgEl.textContent = message;
  
  if (type === 'alert') {
    cancelBtn.style.display = 'none';
    if (variant === 'success') {
      confirmBtn.className = 'btn btn-success btn-sm';
    } else if (variant === 'warning') {
      confirmBtn.className = 'btn btn-secondary btn-sm';
    } else {
      confirmBtn.className = 'btn btn-primary btn-sm';
    }
    confirmBtn.textContent = 'OK';
  } else {
    cancelBtn.style.display = 'inline-flex';
    if (variant === 'success') {
      confirmBtn.className = 'btn btn-success btn-sm';
      confirmBtn.textContent = 'Confirm';
    } else if (variant === 'warning') {
      confirmBtn.className = 'btn btn-secondary btn-sm';
      confirmBtn.textContent = 'Confirm';
    } else {
      confirmBtn.className = 'btn btn-danger btn-sm';
      confirmBtn.textContent = 'Confirm';
    }
  }
  
  modal.style.display = 'flex';
  
  confirmBtn.onclick = () => {
    modal.style.display = 'none';
    if (onConfirm) onConfirm();
  };
  
  cancelBtn.onclick = () => {
    modal.style.display = 'none';
  };
}

// Request Email & Phone OTP
async function handleRequestOtp() {
  const emailInput = document.getElementById('auth-email');
  const phoneInput = document.getElementById('auth-phone');
  const errBox = document.getElementById('auth-error');
  const successBox = document.getElementById('auth-success');
  const requestBtn = document.getElementById('btn-request-otp');

  if (!emailInput || !phoneInput || !errBox || !successBox || !requestBtn) return;

  errBox.style.display = 'none';
  successBox.style.display = 'none';

  const email = emailInput.value.trim().toLowerCase();
  const phone = phoneInput.value.trim();

  if (!email || !phone) {
    errBox.textContent = 'Please enter both your email address and phone number.';
    errBox.style.display = 'block';
    return;
  }

  requestBtn.disabled = true;
  requestBtn.textContent = 'Sending OTP...';

  if (useBackend) {
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone })
      });

      if (!res.ok) {
        throw new Error('Verification failed. Server returned an error.');
      }

      const data = await res.json();

      if (data.success) {
        successBox.textContent = data.message || 'OTPs sent to your email and phone.';
        successBox.style.display = 'block';

        emailInput.disabled = true;
        phoneInput.disabled = true;
        requestBtn.disabled = true;
        requestBtn.textContent = 'OTP Sent';

        const otpSection = document.getElementById('otp-verification-section');
        if (otpSection) otpSection.style.display = 'block';
      } else {
        errBox.textContent = data.message || 'Access Restricted. Please contact LBDA support.';
        errBox.style.display = 'block';
        requestBtn.disabled = false;
        requestBtn.textContent = 'Send OTP';
      }
    } catch (err) {
      console.error('Request OTP API error:', err);
      errBox.textContent = 'Failed to request OTP. Please check your connection.';
      errBox.style.display = 'block';
      requestBtn.disabled = false;
      requestBtn.textContent = 'Send OTP';
    }
  } else {
    // Local Simulation Fallback
    const user = users.find(u => u.email.toLowerCase() === email && String(u.phone || '').trim() === phone);
    if (user) {
      // Generate mock OTPs
      const mockEmailOtp = '123456';
      const mockPhoneOtp = '654321';
      window.localMockOtp = { email, mockEmailOtp, mockPhoneOtp };

      console.log(`[LOCAL SIMULATION OTP] Email: ${email}, Phone: ${phone}. Email OTP: ${mockEmailOtp}, Phone OTP: ${mockPhoneOtp}`);
      successBox.innerHTML = `[SIMULATION] OTPs generated! Check developer console.<br>Or use Email OTP: <code>${mockEmailOtp}</code> and Phone OTP: <code>${mockPhoneOtp}</code>`;
      successBox.style.display = 'block';

      emailInput.disabled = true;
      phoneInput.disabled = true;
      requestBtn.disabled = true;
      requestBtn.textContent = 'OTP Sent';

      const otpSection = document.getElementById('otp-verification-section');
      if (otpSection) otpSection.style.display = 'block';
    } else {
      errBox.textContent = 'Access Restricted. Please contact LBDA support.';
      errBox.style.display = 'block';
      requestBtn.disabled = false;
      requestBtn.textContent = 'Send OTP';
    }
  }
}

// Verify OTP & Login
async function handleVerifyOtp() {
  const emailInput = document.getElementById('auth-email');
  const otpInput = document.getElementById('auth-otp');
  const errBox = document.getElementById('auth-error');
  const successBox = document.getElementById('auth-success');
  const verifyBtn = document.getElementById('btn-verify-otp');

  if (!emailInput || !otpInput || !errBox || !successBox || !verifyBtn) return;

  errBox.style.display = 'none';
  successBox.style.display = 'none';

  const email = emailInput.value.trim().toLowerCase();
  const otp = otpInput.value.trim();

  if (!otp) {
    errBox.textContent = 'Please enter your verification OTP.';
    errBox.style.display = 'block';
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Verifying...';

  // Send the single otp as both emailOtp and phoneOtp to satisfy the backend route
  const emailOtp = otp;
  const phoneOtp = otp;

  if (useBackend) {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, emailOtp, phoneOtp })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        successBox.textContent = 'Login successful!';
        successBox.style.display = 'block';

        currentUser = data.user;
        localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));

        setTimeout(() => {
          resolveClientPortalView();
          resetOtpRequest();
          switchTab('referral');
          showNotification(`Welcome back, ${currentUser.name}!`, 'success');
        }, 800);
      } else {
        errBox.textContent = data.message || 'Incorrect verification code. Please try again.';
        errBox.style.display = 'block';
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & Sign In';
      }
    } catch (err) {
      console.error('Verify OTP API error:', err);
      errBox.textContent = 'Verification request failed. Please try again.';
      errBox.style.display = 'block';
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify & Sign In';
    }
  } else {
    // Local Simulation Fallback
    const mock = window.localMockOtp;
    if (mock && mock.email === email && (mock.mockEmailOtp === otp || mock.mockPhoneOtp === otp)) {
      const user = users.find(u => u.email.toLowerCase() === email);
      
      successBox.textContent = 'Login successful (Simulation)!';
      successBox.style.display = 'block';

      currentUser = user;
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      window.localMockOtp = null;

      setTimeout(() => {
        resolveClientPortalView();
        resetOtpRequest();
        switchTab('referral');
        showNotification(`Welcome back, ${currentUser.name}!`, 'success');
      }, 800);
    } else {
      errBox.textContent = 'Incorrect verification code. Please try again.';
      errBox.style.display = 'block';
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify & Sign In';
    }
  }
}

// Reset Form State
function resetOtpRequest() {
  const emailInput = document.getElementById('auth-email');
  const phoneInput = document.getElementById('auth-phone');
  const otpInput = document.getElementById('auth-otp');
  const errBox = document.getElementById('auth-error');
  const successBox = document.getElementById('auth-success');
  const requestBtn = document.getElementById('btn-request-otp');
  const verifyBtn = document.getElementById('btn-verify-otp');
  const otpSection = document.getElementById('otp-verification-section');

  if (emailInput) {
    emailInput.disabled = false;
    emailInput.value = '';
  }
  if (phoneInput) {
    phoneInput.disabled = false;
    phoneInput.value = '';
  }
  if (otpInput) otpInput.value = '';
  if (errBox) errBox.style.display = 'none';
  if (successBox) successBox.style.display = 'none';
  
  if (requestBtn) {
    requestBtn.disabled = false;
    requestBtn.textContent = 'Send OTP';
  }
  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verify & Sign In';
  }
  if (otpSection) otpSection.style.display = 'none';
}
// Log out active session
function logoutUser() {
  localStorage.removeItem('gbd_current_user');
  localStorage.removeItem('gbd_active_referral');
  localStorage.removeItem('gbd_active_referrer_name');
  localStorage.removeItem('gbd_active_coupon_code');
  currentUser = null;
  cart = [];
  const banner = document.getElementById('referred-banner');
  if (banner) banner.style.display = 'none';
  document.getElementById('portal-panel').style.display = 'none';
  document.getElementById('migration-landing-panel').style.display = 'none';
  document.getElementById('auth-panel').style.display = 'block';
  resetOtpRequest();
}

// Switch tabs inside portal
function switchTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('nav.nav-tabs .tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`menu-btn-${tabName}`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });
  document.getElementById(`tab-${tabName}`).style.display = 'block';

  // Load specific tab dataset
  if (tabName === 'courses') {
    renderCoursesCatalog();
  } else if (tabName === 'cart') {
    renderCart();
  } else if (tabName === 'referral') {
    renderReferralKit();
  } else if (tabName === 'profile') {
    renderProfile();
  }
}

// Render Courses Catalog
function renderCoursesCatalog() {
  // Update buttons based on enrollment state
  const enrolledCourses = currentUser.purchased_courses || [];
  
  // We have 3 course cards in the HTML: 1, 2, 3
  document.querySelectorAll('#tab-courses .course-card').forEach((card, index) => {
    const courseId = index + 1;
    const btn = card.querySelector('button');
    if (btn) {
      if (enrolledCourses.includes(courseId)) {
        btn.textContent = '✓ Enrolled';
        btn.disabled = true;
        btn.className = 'btn btn-secondary';
        btn.style.width = '100%';
      } else {
        btn.textContent = 'Add to Cart';
        btn.disabled = false;
        btn.className = 'btn btn-primary';
        btn.style.width = '100%';
      }
    }
  });
}

// Shopping Cart Actions
function addToCart(id, title, price) {
  // Check if already in cart
  if (cart.some(item => item.id === id)) {
    const card = document.querySelectorAll('.course-card')[id - 1];
    if (card) {
      const btn = card.querySelector('button');
      if (btn) {
        btn.textContent = 'Already in Cart!';
        btn.className = 'btn btn-secondary';
        btn.style.width = '100%';
        btn.disabled = true;
        setTimeout(() => {
          renderCoursesCatalog();
        }, 2000);
      }
    }
    return;
  }
  
  cart.push({ id, title, price });
  document.getElementById('cart-count').textContent = cart.length;
  
  // Render catalog first so the visual change overrides it
  renderCoursesCatalog();
  
  const card = document.querySelectorAll('.course-card')[id - 1];
  if (card) {
    const btn = card.querySelector('button');
    if (btn) {
      btn.textContent = '✓ Added!';
      btn.className = 'btn btn-success';
      btn.style.width = '100%';
      btn.disabled = true;
      setTimeout(() => {
        renderCoursesCatalog();
      }, 2000);
    }
  }
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  document.getElementById('cart-count').textContent = cart.length;
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items-list');
  const subtotalEl = document.getElementById('cart-summary-subtotal');
  const discountEl = document.getElementById('cart-summary-discount');
  const totalEl = document.getElementById('cart-summary-total');
  const discountRow = document.getElementById('summary-discount-row');
  const checkoutBtn = document.getElementById('btn-checkout');

  container.innerHTML = '';

  if (cart.length === 0) {
    container.innerHTML = `<div class="cookie-empty" style="text-align: center; padding: 2rem;">Your cart is empty. Browse courses to add items.</div>`;
    subtotalEl.textContent = '₹0.00';
    totalEl.textContent = '₹0.00';
    discountRow.style.display = 'none';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }
  if (checkoutBtn) checkoutBtn.disabled = false;

  let subtotal = 0;
  cart.forEach(item => {
    subtotal += item.price;
    container.innerHTML += `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${item.title}</h4>
          <span>Price: ₹${item.price.toLocaleString('en-IN')}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeFromCart(${item.id})">Remove</button>
      </div>
    `;
  });

  subtotalEl.textContent = `₹${subtotal.toLocaleString('en-IN')}`;

  // Calculate discount dynamically based on referred_by and systemSettings
  let discount = 0;
  const isReferralActive = !!currentUser.referred_by && systemSettings.friend_discount_enabled;

  if (isReferralActive) {
    const percent = systemSettings.friend_discount_percent || 10;
    discount = subtotal * (percent / 100);
    
    const labelEl = document.getElementById('discount-label');
    if (labelEl) labelEl.textContent = `Referral Discount (${percent}%):`;
    
    discountRow.style.display = 'flex';
    discountEl.textContent = `-₹${discount.toLocaleString('en-IN')}`;
  } else {
    discountRow.style.display = 'none';
  }

  const total = subtotal - discount;
  totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;

  updateReferredBanner();
}

// Apply typed coupon code manually
async function applyCartCoupon() {
  const code = document.getElementById('cart-coupon-input').value.trim().toUpperCase();
  const validationMsg = document.getElementById('coupon-validation-msg');

  if (!code) {
    validationMsg.textContent = 'Please enter a coupon code.';
    validationMsg.className = 'text-danger';
    return;
  }

  if (useBackend) {
    try {
      const res = await fetch(`/api/referrals/lookup?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Invalid coupon code.');
      }
      const match = await res.json();
      if (match.email === currentUser.email) {
        validationMsg.textContent = 'You cannot use your own referral code.';
        validationMsg.className = 'text-danger';
        return;
      }
      
      localStorage.setItem('gbd_active_referral', match.affiliate_code);
      localStorage.setItem('gbd_active_referrer_name', match.name);
      localStorage.setItem('gbd_active_coupon_code', match.coupon_code);
      
      validationMsg.textContent = `✓ Coupon applied! Referred by ${match.name}. 10% discount added.`;
      validationMsg.className = 'text-success';
      
      renderCart(); // Recalculate
    } catch (err) {
      validationMsg.textContent = err.message;
      validationMsg.className = 'text-danger';
    }
  } else {
    const match = referralProfiles.find(r => r.coupon_code === code);
    if (match) {
      if (match.email === currentUser.email) {
        validationMsg.textContent = 'You cannot use your own referral code.';
        validationMsg.className = 'text-danger';
        return;
      }
      const referrerUser = users.find(u => u.email === match.email);
      const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
      
      localStorage.setItem('gbd_active_referral', match.affiliate_code);
      localStorage.setItem('gbd_active_referrer_name', referrerName);
      localStorage.setItem('gbd_active_coupon_code', match.coupon_code);
      
      validationMsg.textContent = `✓ Coupon applied! Referred by ${referrerName}. 10% discount added.`;
      validationMsg.className = 'text-success';
      
      renderCart(); // Recalculate
    } else {
      validationMsg.textContent = 'Invalid coupon code.';
      validationMsg.className = 'text-danger';
    }
  }
}

// Complete checkout purchase
async function checkoutCart() {
  if (cart.length === 0) {
    return;
  }

  try {
    let finalEnrolled = [...(currentUser.purchased_courses || [])];
    
    // Purchase all items in cart via API
    for (const item of cart) {
      const res = await fetch('/api/courses/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentUser.email,
          courseId: item.id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      finalEnrolled = data.purchased_courses;
    }
    
    currentUser.purchased_courses = finalEnrolled;
    localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
    
    // Reload database
    await initDatabase();

    showNotification('Thank you! Enrollments confirmed.', 'success');
  } catch (apiErr) {
    console.warn('Checkout API error, trying LocalStorage fallback:', apiErr.message);

    // LocalStorage Fallback logic
    const dbUser = users.find(u => u.email === currentUser.email);
    if (!dbUser.purchased_courses) dbUser.purchased_courses = [];

    cart.forEach(item => {
      if (!dbUser.purchased_courses.includes(item.id)) {
        dbUser.purchased_courses.push(item.id);
      }
    });

    if (currentUser.referred_by && systemSettings.commission_enabled) {
      const referrerProfile = referralProfiles.find(r => r.email.toLowerCase() === currentUser.referred_by.toLowerCase());
      if (referrerProfile) {
        const referrerUser = users.find(u => u.email.toLowerCase() === referrerProfile.email.toLowerCase());
        const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
        const commAmt = parseFloat(systemSettings.commission_amount) || 20.00;

        // Credit flat dynamic commission
        referrerProfile.earnings = (referrerProfile.earnings || 0) + commAmt;
        referrerProfile.referrals_count = (referrerProfile.referrals_count || 0) + 1;

        // Add to signups log
        signups.push({
          affiliate_code: referrerProfile.affiliate_code,
          affiliate_name: referrerName,
          friend_email: currentUser.email,
          commission_amount: commAmt,
          created_at: new Date().toISOString()
        });

        logSystemEvent('FriendSignedUp', {
          friend_email: currentUser.email,
          affiliate_code: referrerProfile.affiliate_code,
          affiliate_name: referrerName,
          attribution_source: 'Signup Binding',
          commission_earned: commAmt
        });
      }
    } else {
      logSystemEvent('UnattributedSignUp', {
        friend_email: currentUser.email,
        items: cart.map(i => i.title)
      });
    }

    // Save changes
    currentUser = dbUser;
    localStorage.setItem('gbd_current_user', JSON.stringify(dbUser));
    saveDatabase();

    showNotification('Thank you! Enrollments confirmed (Local).', 'success');
  }

  // Clear cart and referral sessions
  cart = [];
  document.getElementById('cart-count').textContent = 0;
  localStorage.removeItem('gbd_active_referral');
  localStorage.removeItem('gbd_active_referrer_name');
  localStorage.removeItem('gbd_active_coupon_code');
  document.getElementById('referred-banner').style.display = 'none';

  switchTab('profile');
}

// Render Referral Tab
function renderReferralKit() {
  const profile = getOrCreateReferralProfile(currentUser.email, currentUser.name);
  document.getElementById('ref-aff-code').textContent = profile.affiliate_code;
  document.getElementById('ref-coupon-code').textContent = profile.coupon_code;
  
  const linkUrl = `${window.location.origin}/index.html?ref=${profile.affiliate_code}`;
  document.getElementById('ref-link-url').value = linkUrl;

  // Dynamically update text block in Referral Toolkit
  const textEl = document.querySelector('#tab-referral p');
  if (textEl) {
    const disc = systemSettings.friend_discount_enabled ? `${systemSettings.friend_discount_percent}%` : '0%';
    const comm = systemSettings.commission_enabled ? `₹${parseFloat(systemSettings.commission_amount).toLocaleString('en-IN')}` : '₹0';
    textEl.innerHTML = `Copy your links below to share with friends. When they sign up using your link or code, they save <strong>${disc}</strong> on checkout, and you earn <strong>${comm} cash</strong>!`;
  }
}

// Clipboard copying referral URL
function copyReferralLink() {
  const copyText = document.getElementById('ref-link-url');
  copyText.select();
  navigator.clipboard.writeText(copyText.value)
    .then(() => {
      const btn = document.getElementById('btn-copy-link');
      if (btn) {
        btn.textContent = 'Copied!';
        btn.className = 'btn btn-success btn-sm';
        setTimeout(() => {
          btn.textContent = 'Copy Link';
          btn.className = 'btn btn-secondary btn-sm';
        }, 2000);
      }
    })
    .catch(err => console.error(err));
}

// Render Profile Tab
function renderProfile() {
  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-email').textContent = currentUser.email;
  
  const profile = getOrCreateReferralProfile(currentUser.email, currentUser.name);
  document.getElementById('profile-code').textContent = profile.affiliate_code;
  
  const earnings = useBackend ? (parseFloat(profile.total_commission) || 0) : (parseFloat(profile.earnings) || 0);
  const referralsCount = useBackend ? (profile.total_signups || 0) : (profile.referrals_count || 0);
  
  document.getElementById('profile-referred-count').textContent = referralsCount;
  document.getElementById('profile-earnings').textContent = `₹${earnings.toLocaleString('en-IN')}`;

  // List purchased courses
  const tbody = document.getElementById('profile-purchased-tbody');
  tbody.innerHTML = '';

  const list = currentUser.purchased_courses || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color:var(--text-muted); font-style:italic;">No courses enrolled yet.</td></tr>`;
    return;
  }

  const coursesMapping = {
    1: 'The Gap',
    2: 'The Bridge',
    3: 'The Journey'
  };

  list.forEach(cid => {
    const dateStr = new Date().toLocaleDateString();
    tbody.innerHTML += `
      <tr>
        <td style="font-weight: 600; color: var(--text-main);">${coursesMapping[cid]}</td>
        <td>${dateStr}</td>
        <td><span class="badge badge-active">Active</span></td>
      </tr>
    `;
  });
}

/* ==========================================================================
   ADMIN PORTAL LOGIC (admin.html)
   ========================================================================== */

let adminPollInterval = null;

async function checkAdminSession() {
  const emailEl = document.getElementById('session-email');
  const roleEl = document.getElementById('session-role');
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (!emailEl || !roleEl) return;

  try {
    const res = await fetch('/api/user');
    const data = await res.json();
    if (data.authenticated && ['MD', 'OPERATIONS', 'FINANCE'].includes(data.user.role)) {
      emailEl.textContent = data.user.email;
      roleEl.textContent = data.user.role;
      roleEl.style.background = getRoleBadgeColor(data.user.role);
      roleEl.style.color = '#fff';
      if (logoutBtn) logoutBtn.style.display = 'block';
    } else {
      emailEl.textContent = 'Not Logged In';
      roleEl.textContent = 'Guest';
      roleEl.style.background = '#6c757d';
      roleEl.style.color = '#fff';
      if (logoutBtn) logoutBtn.style.display = 'none';
    }
  } catch (err) {
    emailEl.textContent = 'Offline';
    roleEl.textContent = 'Guest';
    roleEl.style.background = '#6c757d';
    roleEl.style.color = '#fff';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

function getRoleBadgeColor(role) {
  if (role === 'MD') return 'var(--danger)';
  if (role === 'OPERATIONS') return 'var(--secondary)';
  if (role === 'FINANCE') return 'var(--success)';
  if (role === 'PARTNER') return '#6f42c1';
  return '#6c757d';
}

async function autoLogin(email, phone) {
  showNotification(`Requesting OTP for ${email}...`, 'success');
  try {
    const reqRes = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone })
    });
    const reqData = await reqRes.json();
    if (!reqData.success) {
      showNotification(`OTP request failed: ${reqData.message}`, 'error');
      return;
    }

    const debugRes = await fetch('/api/debug/otps');
    const debugData = await debugRes.json();
    const userOtp = debugData.otps[email.toLowerCase()];
    
    if (!userOtp) {
      showNotification(`No debug OTP found for ${email}.`, 'error');
      return;
    }

    const verifyRes = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        emailOtp: userOtp.emailOtp,
        phoneOtp: userOtp.phoneOtp
      })
    });
    const verifyData = await verifyRes.json();
    
    if (verifyData.success) {
      showNotification(`Auth Success: Logged in as ${email}`, 'success');
      await checkAdminSession();
      
      if (isClientPage) {
        location.reload();
      } else {
        const role = verifyData.user ? verifyData.user.role : 'USER';
        if (role === 'USER') {
          showNotification('Logged in as client. Redirecting to Client Portal...', 'success');
          setTimeout(() => {
            window.location.href = '/index.html';
          }, 1500);
        } else {
          await loadAdminPortalData();
        }
      }
    } else {
      showNotification(`Verification failed: ${verifyData.message}`, 'error');
    }
  } catch (err) {
    showNotification(`Auto-login error: ${err.message}`, 'error');
  }
}

async function logout() {
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const data = await res.json();
    showNotification(data.message || 'Logged out.', 'success');
  } catch (err) {
    console.error('Logout error:', err.message);
  }
  localStorage.removeItem('gbd_current_user');
  localStorage.removeItem('gbd_active_referral');
  currentUser = null;
  
  if (isClientPage) {
    location.reload();
  } else {
    checkAdminSession();
    loadAdminPortalData();
  }
}

function initAdminPortal() {
  checkAdminSession();
  loadAdminPortalData();
  // Poll database changes every 2 seconds
  adminPollInterval = setInterval(loadAdminPortalData, 2000);
}

async function loadAdminPortalData() {
  try {
    const res = await fetch('/api/admin/data');
    if (res.status === 401 || res.status === 403) {
      users = [];
      allBatches = [];
      referrals = [];
      renderAdminUsersTable();
      renderAdminAffiliatesTable();
      checkAdminSession();
      return;
    }
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    users = data.users || [];
    referralProfiles = data.affiliates || [];
    clicks = data.clicks || [];
    signups = data.signups || [];
    allSignups = data.allSignups || [];
    eventLogs = data.events || [];
    allBatches = data.batches || [];
    referrals = data.referrals || [];
    
    populateBatchDropdowns();
  } catch (err) {
    console.warn('Backend server offline during polling, reading from LocalStorage:', err.message);
    users = JSON.parse(localStorage.getItem('gbd_users_v4')) || [];
    referralProfiles = JSON.parse(localStorage.getItem('gbd_referrals_v4')) || [];
    clicks = JSON.parse(localStorage.getItem('gbd_clicks_v4')) || [];
    signups = JSON.parse(localStorage.getItem('gbd_signups_v4')) || [];
    allSignups = signups;
    eventLogs = JSON.parse(localStorage.getItem('gbd_events_v4')) || [];
  }

  if (!editingClientEmail) {
    renderAdminUsersTable();
  }
  if (!editingAffiliateCode) {
    renderAdminAffiliatesTable();
  }
  renderAdminClicksTable();
  renderAdminSignupsTable();
  renderEventsConsole(eventLogs);
}

function populateBatchDropdowns() {
  const inviteBatch = document.getElementById('invite-batch');
  const editBatch = document.getElementById('edit-user-batch');
  if (!inviteBatch || !editBatch) return;
  
  if (inviteBatch.children.length > 1) return;

  let html = '<option value="">No Batch Assigned</option>';
  for (const b of allBatches) {
    html += `<option value="${b.id}">${b.name} (${b.code})</option>`;
  }
  inviteBatch.innerHTML = html;
  editBatch.innerHTML = html;
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--text-muted); padding: 1.5rem;">No client accounts registered.</td></tr>`;
    return;
  }

  users.forEach(u => {
    const roleColor = getRoleBadgeColor(u.role);
    const batchName = u.batch_name || 'No Batch';
    
    tbody.innerHTML += `
      <tr>
        <td>${u.id}</td>
        <td>
          <div style="font-weight: 600; color: var(--text-main);">${u.name}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${u.email}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${u.phone || 'No Phone'}</div>
        </td>
        <td>
          <span class="badge" style="background: ${roleColor}; color: #fff;">${u.role}</span>
        </td>
        <td>
          <span style="font-size: 0.85rem; font-weight: 500;">${batchName}</span>
        </td>
        <td>
          <span class="badge" style="background: #6f42c1; color: #fff;">${u.current_stage}</span>
        </td>
        <td>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;">
            <button class="btn btn-secondary btn-sm" onclick="showEditUserModal(${JSON.stringify(u).replace(/"/g, '&quot;')})" style="font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClient('${u.email}')" style="background-color: var(--danger); border-color: var(--danger); font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Delete</button>
            <button class="btn btn-success btn-sm" onclick="autoLogin('${u.email}', '${u.phone}')" style="background-color: var(--success); border-color: var(--success); font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Login</button>
            <button class="btn btn-secondary btn-sm" onclick="advanceStageAdmin(${u.id}, '${u.current_stage}')" style="font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Advance</button>
            ${renderStageActionButton(u)}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderStageActionButton(u) {
  if (u.current_stage === 'MASTERCLASS') {
    return `<button class="btn btn-sm" onclick="markMasterclassAttendance(${u.id}, 'Attended')" style="background: var(--warning); border-color: var(--warning); color: #fff; font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Mark Attended</button>`;
  }
  if (u.current_stage === 'GAP') {
    return `<button class="btn btn-sm" onclick="completeGap(${u.id})" style="background: var(--warning); border-color: var(--warning); color: #fff; font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Complete GAP</button>`;
  }
  if (u.current_stage === 'BRIDGE') {
    return `<button class="btn btn-sm" onclick="completeBridge(${u.id})" style="background: var(--warning); border-color: var(--warning); color: #fff; font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Complete Bridge</button>`;
  }
  if (u.current_stage === 'CERTIFICATION') {
    return `<button class="btn btn-sm" onclick="certifyPartner(${u.id})" style="background: var(--warning); border-color: var(--warning); color: #fff; font-size:0.75rem; padding: 3px 6px; cursor: pointer;">Certify Graduate</button>`;
  }
  if (u.current_stage === 'PARTNER') {
    return `<button class="btn btn-sm" onclick="addDeliveryParticipant(${u.id}, '${u.name}')" style="background: var(--warning); border-color: var(--warning); color: #fff; font-size:0.75rem; padding: 3px 6px; cursor: pointer;">+ Credit Coaching</button>`;
  }
  return '';
}

function renderAdminAffiliatesTable() {
  const tbody = document.getElementById('admin-affiliates-tbody');
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color:var(--text-muted);">No users found.</td></tr>`;
    return;
  }

  users.forEach(u => {
    const profile = referralProfiles.find(r => r.email === u.email);
    if (!profile) {
      tbody.innerHTML += `
        <tr>
          <td style="font-weight: 600; color: var(--text-main);">${u.name}</td>
          <td>${u.email}</td>
          <td><span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">Not Activated</span></td>
          <td><span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">Not Activated</span></td>
          <td><span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">Not Activated</span></td>
          <td style="font-weight:500;">0</td>
          <td style="font-weight:500;">0</td>
          <td style="font-weight: bold; color: var(--warning);">$0.00</td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" disabled style="opacity: 0.5;">Edit</button>
              <button class="btn btn-danger btn-sm" disabled style="opacity: 0.5; background-color: var(--danger); border-color: var(--danger);">Delete</button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const clicksCount = clicks.filter(c => c.affiliate_code === profile.affiliate_code).length;
    const signupsCount = signups.filter(s => s.affiliate_code === profile.affiliate_code).length;
    const commTotal = useBackend ? (parseFloat(profile.total_commission) || 0.0) : (parseFloat(profile.earnings) || 0.0);

    const referralLink = `${window.location.origin}/index.html?ref=${profile.affiliate_code}`;

    if (profile.affiliate_code === editingAffiliateCode) {
      tbody.innerHTML += `
        <tr>
          <td style="font-weight: 600; color: var(--text-main);">${u.name}</td>
          <td>${u.email}</td>
          <td><input type="text" id="edit-affiliate-code-${profile.affiliate_code}" value="${profile.affiliate_code}" class="input-sm" style="text-transform: uppercase; font-family: var(--font-mono); font-weight: bold;"></td>
          <td><input type="text" id="edit-affiliate-coupon-${profile.affiliate_code}" value="${profile.coupon_code}" class="input-sm" style="text-transform: uppercase; font-family: var(--font-mono); font-weight: bold;"></td>
          <td><span style="color: var(--text-muted); font-style: italic; font-size: 0.8rem;">Will update on save</span></td>
          <td style="font-weight:500;">${clicksCount}</td>
          <td style="font-weight:500;">${signupsCount}</td>
          <td style="font-weight: bold; color: var(--warning);">$${commTotal.toFixed(2)}</td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-success btn-sm" onclick="saveAffiliateEdit('${profile.affiliate_code}')">Save</button>
              <button class="btn btn-secondary btn-sm" onclick="cancelAffiliateEdit()">Cancel</button>
            </div>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML += `
        <tr>
          <td style="font-weight: 600; color: var(--text-main);">${u.name}</td>
          <td>${u.email}</td>
          <td><code style="color: var(--secondary); font-weight: bold;">${profile.affiliate_code}</code></td>
          <td><code style="color: var(--success); font-weight: bold;">${profile.coupon_code}</code></td>
          <td class="referral-link-cell"><a href="${referralLink}" target="_blank" style="font-size: 0.85rem;">${referralLink}</a></td>
          <td style="font-weight:500;">${clicksCount}</td>
          <td style="font-weight:500;">${signupsCount}</td>
          <td style="font-weight: bold; color: var(--warning);">$${commTotal.toFixed(2)}</td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" onclick="editAffiliate('${profile.affiliate_code}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteAffiliate('${profile.affiliate_code}')" style="background-color: var(--danger); border-color: var(--danger);">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }
  });
}

function renderAdminClicksTable() {
  const tbody = document.getElementById('admin-clicks-tbody');
  tbody.innerHTML = '';

  if (clicks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color:var(--text-muted); font-style:italic;">No clicks logged.</td></tr>`;
    return;
  }

  const logs = [...clicks].reverse().slice(0, 10);
  logs.forEach(c => {
    const dateStr = new Date(c.created_at).toLocaleTimeString();
    tbody.innerHTML += `
      <tr>
        <td style="font-weight:600;">${c.affiliate_name}</td>
        <td><code>${c.ip}</code></td>
        <td style="color: var(--text-muted); font-size:0.8rem;">${dateStr}</td>
      </tr>
    `;
  });
}

function renderAdminSignupsTable() {
  const tbody = document.getElementById('admin-signups-tbody');
  tbody.innerHTML = '';

  if (signups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--text-muted); font-style:italic;">No signups logged.</td></tr>`;
    return;
  }

  const logs = [...signups].reverse().slice(0, 10);
  logs.forEach(s => {
    const dateStr = new Date(s.created_at).toLocaleTimeString();
    tbody.innerHTML += `
      <tr>
        <td style="font-weight:600;">${s.affiliate_name}</td>
        <td><code>${s.friend_email}</code></td>
        <td style="font-weight:bold; color:var(--success);">$${s.commission_amount.toFixed(2)}</td>
        <td style="color: var(--text-muted); font-size:0.8rem;">${dateStr}</td>
      </tr>
    `;
  });
}

function renderEventsConsole(events) {
  const consoleEl = document.getElementById('logger-console');
  if (!consoleEl) return;
  const shouldScroll = consoleEl.scrollHeight - consoleEl.scrollTop === consoleEl.clientHeight || consoleEl.scrollTop === 0;

  consoleEl.innerHTML = '';

  if (events.length === 0) {
    consoleEl.innerHTML = `<div class="log-entry"><span class="log-tag log-tag-system">SYSTEM</span>Console active. Awaiting hooks...</div>`;
    return;
  }

  const recent = [...events].reverse().slice(0, 30).reverse();
  recent.forEach(e => {
    const dateStr = new Date(e.created_at).toLocaleTimeString();
    const payload = JSON.parse(e.payload);
    
    let tagClass = 'log-tag-system';
    const typeLower = e.event_type.toLowerCase();
    
    if (typeLower.includes('click')) tagClass = 'log-tag-click';
    else if (typeLower.includes('signup') || typeLower.includes('join') || typeLower.includes('friend')) tagClass = 'log-tag-order';
    else if (typeLower.includes('register') || typeLower.includes('affiliate') || typeLower.includes('referral')) tagClass = 'log-tag-cookie';
    
    let logText = '';
    if (e.event_type === 'AffiliateRegistered') {
      logText = `Affiliate Registered: ${payload.name} (${payload.email}). Code: ${payload.affiliate_code}, Coupon: ${payload.coupon_code}`;
    } else if (e.event_type === 'ClickCreated') {
      logText = `Link Click tracked for affiliate ${payload.affiliate_name}. Code: ${payload.affiliate_code}`;
    } else if (e.event_type === 'FriendSignedUp') {
      logText = `Friend Signup completed: ${payload.friend_email} attributed to ${payload.affiliate_name} via ${payload.attribution_source}. Earned $${payload.commission_earned.toFixed(2)}`;
    } else if (e.event_type === 'UnattributedSignUp') {
      logText = `Checkout completed without referral. Email: ${payload.friend_email}`;
    } else if (e.event_type === 'ReferralProfileCreated') {
      logText = `Referral profile created: ${payload.email}. Code: ${payload.affiliate_code}`;
    } else {
      logText = JSON.stringify(payload);
    }

    consoleEl.innerHTML += `
      <div class="log-entry">
        <span class="log-time">${dateStr}</span>
        <span class="log-tag ${tagClass}">${e.event_type}</span>
        <span class="log-body">${logText}</span>
      </div>
    `;
  });

  if (shouldScroll) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

function clearEventLogs() {
  localStorage.setItem('gbd_events_v4', JSON.stringify([]));
  initDatabase();
  logSystemEvent('ActivityLogCleared', { timestamp: new Date().toISOString() });
}

function resetDatabaseToSeed() {
  showCustomModal({
    title: 'Reset Affiliation Database',
    message: 'Are you sure you want to reset the database? This will clear all accounts and referral logs.',
    variant: 'warning',
    onConfirm: async () => {
      try {
        const res = await fetch('/api/admin/reset', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset database');
        
        localStorage.removeItem('gbd_current_user');
        localStorage.removeItem('gbd_active_referral');
        
        await initDatabase();
        showCustomModal({
          title: 'Database Cleared',
          message: 'Database cleared successfully.',
          type: 'alert',
          variant: 'success'
        });
        if (isClientPage) {
          location.reload();
        } else {
          loadAdminPortalData();
          switchAdminTab('users');
        }
      } catch (apiErr) {
        console.warn('Reset API error, trying LocalStorage fallback:', apiErr.message);
        
        localStorage.removeItem('gbd_users_v4');
        localStorage.removeItem('gbd_referrals_v4');
        localStorage.removeItem('gbd_clicks_v4');
        localStorage.removeItem('gbd_signups_v4');
        localStorage.removeItem('gbd_events_v4');
        localStorage.removeItem('gbd_current_user');
        localStorage.removeItem('gbd_active_referral');
        
        await initDatabase();
        showCustomModal({
          title: 'Database Cleared',
          message: 'Database cleared successfully (Local).',
          type: 'alert',
          variant: 'success'
        });
        if (isClientPage) {
          location.reload();
        } else {
          loadAdminPortalData();
          switchAdminTab('users');
        }
      }
    }
  });
}

let activeAdminTab = 'users';

function switchAdminTab(tabName) {
  activeAdminTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.nav-tabs button').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`admin-tab-btn-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Update tab contents
  document.querySelectorAll('.admin-tab-content').forEach(content => {
    content.style.display = 'none';
  });
  const activeContent = document.getElementById(`admin-tab-${tabName}`);
  if (activeContent) {
    activeContent.style.display = 'block';
  }
  
  if (tabName === 'tree') {
    renderReferralTree();
    initPanZoom();
  } else if (tabName === 'settings') {
    loadSystemSettings();
    loadBatchSchedules();
  }
}

// Client Account CRUD operations
function deleteClient(email) {
  showCustomModal({
    title: 'Delete Client Account',
    message: `WARNING: Are you sure you want to delete the client account for ${email}? This will permanently wipe out their profile, course enrollment data, and all associated affiliate logs.`,
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/admin/user/${encodeURIComponent(email)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete client');
        
        showNotification(data.message || 'Client account deleted.', 'success');
        await initDatabase();
        loadAdminPortalData();
      } catch (err) {
        console.warn('API error, trying LocalStorage fallback:', err);
        users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
        referralProfiles = referralProfiles.filter(r => r.email.toLowerCase() !== email.toLowerCase());
        saveDatabase();
        showNotification('Client account deleted (Local).', 'success');
        loadAdminPortalData();
      }
    }
  });
}

// Invite User Modal Controls
function showInviteModal() {
  const modal = document.getElementById('invite-user-modal');
  if (modal) {
    const select = document.getElementById('invite-batch');
    if (select) {
      let html = '<option value="">No Batch Assigned</option>';
      allBatches.forEach(b => {
        html += `<option value="${b.id}">${b.name} (${b.code})</option>`;
      });
      select.innerHTML = html;
    }
    modal.style.display = 'flex';
  }
}

function closeInviteModal() {
  const modal = document.getElementById('invite-user-modal');
  if (modal) modal.style.display = 'none';
}

async function submitInviteUser(e) {
  e.preventDefault();
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const phone = document.getElementById('invite-phone').value.trim();
  const batch_id = document.getElementById('invite-batch').value ? parseInt(document.getElementById('invite-batch').value, 10) : null;
  const role = document.getElementById('invite-role').value;
  const current_stage = document.getElementById('invite-stage').value;

  try {
    const res = await fetch('/api/admin/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, batch_id, role, current_stage })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message || 'User invited successfully.', 'success');
      closeInviteModal();
      document.getElementById('invite-user-form').reset();
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Request failed: ${err.message}`, 'error');
  }
}

// Edit User Modal Controls
function showEditUserModal(user) {
  const modal = document.getElementById('edit-user-modal');
  if (modal) {
    document.getElementById('edit-user-original-email').value = user.email;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-name').value = user.name;
    document.getElementById('edit-user-phone').value = user.phone || '';
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-stage').value = user.current_stage;

    const select = document.getElementById('edit-user-batch');
    if (select) {
      let html = '<option value="">No Batch Assigned</option>';
      allBatches.forEach(b => {
        html += `<option value="${b.id}">${b.name} (${b.code})</option>`;
      });
      select.innerHTML = html;
      select.value = user.batch_id || '';
    }
    modal.style.display = 'flex';
  }
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  if (modal) modal.style.display = 'none';
}

async function submitEditUser(e) {
  e.preventDefault();
  const originalEmail = document.getElementById('edit-user-original-email').value;
  const name = document.getElementById('edit-user-name').value.trim();
  const phone = document.getElementById('edit-user-phone').value.trim();
  const batch_id = document.getElementById('edit-user-batch').value ? parseInt(document.getElementById('edit-user-batch').value, 10) : null;
  const role = document.getElementById('edit-user-role').value;
  const current_stage = document.getElementById('edit-user-stage').value;

  try {
    const res = await fetch(`/api/admin/user/${encodeURIComponent(originalEmail)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, batch_id, role, current_stage })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message || 'User updated successfully.', 'success');
      closeEditUserModal();
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Request failed: ${err.message}`, 'error');
  }
}

// Stage Progression API Calls
async function advanceStageAdmin(userId, currentStage) {
  const stages = ['INVITED', 'MASTERCLASS', 'REGISTRATION', 'GAP', 'PAYMENT_1', 'BRIDGE', 'PAYMENT_2', 'CERTIFICATION', 'PARTNER'];
  const currentIdx = stages.indexOf(currentStage);
  if (currentIdx === -1 || currentIdx === stages.length - 1) {
    showNotification(`User is already a partner or at an invalid stage.`, 'error');
    return;
  }
  const nextStage = stages[currentIdx + 1];
  
  try {
    const res = await fetch('/api/admin/change-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, newStage: nextStage })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function markMasterclassAttendance(userId, status) {
  try {
    const res = await fetch('/api/admin/masterclass/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function completeGap(userId) {
  try {
    const res = await fetch('/api/admin/gap/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function completeBridge(userId) {
  try {
    const res = await fetch('/api/admin/bridge/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function certifyPartner(userId) {
  try {
    const res = await fetch('/api/admin/certify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(`Success: certified and activated partner. Referral Link: ${data.referralLink}`, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

async function addDeliveryParticipant(partnerId, partnerName) {
  const participantName = prompt("Enter Coaching Participant Full Name:");
  if (!participantName) return;
  const participantEmail = prompt("Enter Coaching Participant Email (optional):") || "";
  
  try {
    const res = await fetch('/api/admin/delivery/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId, participantName, participantEmail })
    });
    const data = await res.json();
    if (res.ok) {
      showNotification(data.message, 'success');
      loadAdminPortalData();
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, 'error');
  }
}

// Affiliate Profile CRUD operations
function deleteAffiliate(code) {
  showCustomModal({
    title: 'Delete Referral Profile',
    message: `WARNING: Are you sure you want to delete the referral profile for code ${code}? This will remove their affiliate codes, referral link, and clear all their commission analytics.`,
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/admin/affiliate/${encodeURIComponent(code)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete affiliate profile');
        
        showNotification(data.message || 'Referral profile deleted.', 'success');
        await initDatabase();
        loadAdminPortalData();
      } catch (err) {
        console.warn('API error, trying LocalStorage fallback:', err);
        referralProfiles = referralProfiles.filter(r => r.affiliate_code.toUpperCase() !== code.toUpperCase());
        saveDatabase();
        showNotification('Referral profile deleted (Local).', 'success');
        loadAdminPortalData();
      }
    }
  });
}

function editAffiliate(code) {
  editingAffiliateCode = code;
  renderAdminAffiliatesTable();
}

function cancelAffiliateEdit() {
  editingAffiliateCode = null;
  renderAdminAffiliatesTable();
}

async function saveAffiliateEdit(code) {
  const codeInput = document.getElementById(`edit-affiliate-code-${code}`);
  const couponInput = document.getElementById(`edit-affiliate-coupon-${code}`);
  if (!codeInput || !couponInput) return;

  const newCode = codeInput.value.trim().toUpperCase();
  const newCoupon = couponInput.value.trim().toUpperCase();

  if (newCode === '' || newCoupon === '') {
    showNotification('Affiliate Code and Coupon Code cannot be empty.', 'error');
    return;
  }

  const profile = referralProfiles.find(r => r.affiliate_code.toUpperCase() === code.toUpperCase());
  if (!profile) return;

  try {
    const res = await fetch(`/api/admin/affiliate/${encodeURIComponent(code)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ affiliate_code: newCode, coupon_code: newCoupon })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update referral profile');
    
    showNotification(data.message || 'Referral profile updated.', 'success');
    editingAffiliateCode = null;
    await initDatabase();
    loadAdminPortalData();
  } catch (err) {
    console.warn('API error, trying LocalStorage fallback:', err);
    
    const exists = referralProfiles.some(r => r.affiliate_code.toUpperCase() === newCode && r.affiliate_code.toUpperCase() !== code.toUpperCase());
    if (exists) {
      showCustomModal({
        title: 'Error',
        message: 'Error: Affiliate code already in use.',
        type: 'alert'
      });
      return;
    }
    
    profile.affiliate_code = newCode;
    profile.coupon_code = newCoupon;
    saveDatabase();
    showNotification('Referral profile updated (Local).', 'success');
    editingAffiliateCode = null;
    loadAdminPortalData();
  }
}

/* ==========================================================================
   REFERRAL NETWORK TREE VISUALIZER (PAN & ZOOM)
   ========================================================================== */

function getReferrerEmailForUser(userEmail) {
  const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
  if (!user) return null;
  
  if (useBackend) {
    const ref = referrals.find(r => r.student_id === user.id);
    if (!ref) return null;
    const partner = users.find(u => u.id === ref.partner_id);
    return partner ? partner.email.toLowerCase() : null;
  } else {
    return user.referred_by ? user.referred_by.toLowerCase() : null;
  }
}

function renderReferralTree() {
  const rootContainer = document.getElementById('referral-tree-root');
  if (!rootContainer) return;

  rootContainer.innerHTML = '';

  if (users.length === 0) {
    rootContainer.innerHTML = '<div class="cookie-empty">No registered client accounts to construct tree.</div>';
    return;
  }

  // 1. Build relationships
  const rootNodes = [];
  const childrenMap = {};

  users.forEach(u => {
    const parentEmail = getReferrerEmailForUser(u.email);
    // A root node is a client who has no parent referrer OR whose parent is not in the system users list
    const hasParentInSystem = parentEmail && users.some(user => user.email.toLowerCase() === parentEmail);
    
    if (!hasParentInSystem) {
      rootNodes.push(u);
    } else {
      if (!childrenMap[parentEmail]) {
        childrenMap[parentEmail] = [];
      }
      childrenMap[parentEmail].push(u);
    }
  });

  // 2. Recursive HTML generator
  function compileHtmlForNode(node, isSystemRoot = false) {
    let nodeHtml = '';
    let children = [];

    if (isSystemRoot) {
      const totalNetworkEarnings = referralProfiles.reduce((sum, p) => {
        const amt = useBackend ? (parseFloat(p.total_commission) || 0) : (parseFloat(p.earnings) || 0);
        return sum + amt;
      }, 0);
      nodeHtml = `
        <div class="tree-node system-node">
          <div class="node-name">LIFE<span style="font-weight: 300;">DESIGN</span> Network</div>
          <div class="node-email">System Root</div>
          <div class="node-meta">
            <span>Clients: <strong class="node-code">${users.length}</strong></span>
            <span>Total: <strong class="node-commission">$${totalNetworkEarnings.toFixed(2)}</strong></span>
          </div>
        </div>
      `;
      children = rootNodes;
    } else {
      const profile = referralProfiles.find(p => p.email.toLowerCase() === node.email.toLowerCase());
      const code = profile ? profile.affiliate_code : 'Not Active';
      const earnings = profile ? (useBackend ? (parseFloat(profile.total_commission) || 0) : (parseFloat(profile.earnings) || 0)) : 0;
      const myChildren = childrenMap[node.email.toLowerCase()] || [];

      const isCollapsed = collapsedNodes.has(node.email.toLowerCase());
      const collapsedClass = isCollapsed ? 'collapsed' : '';
      const toggleBadge = myChildren.length > 0 ? `<div class="node-toggle-badge">${myChildren.length}</div>` : '';

      nodeHtml = `
        <div class="tree-node ${collapsedClass}" onclick="toggleNodeCollapse(event, '${node.email.toLowerCase()}')">
          ${toggleBadge}
          <div class="node-edit-btn" onclick="initiateNodeMove(event, '${node.email.toLowerCase()}')" title="Move Client">⇄</div>
          <div class="node-name">${node.name}</div>
          <div class="node-email">${node.email}</div>
          <div class="node-meta">
            <span class="node-code">${code}</span>
            <span class="node-commission">$${earnings.toFixed(2)}</span>
          </div>
        </div>
      `;
      children = isCollapsed ? [] : myChildren;
    }

    let childrenHtml = '';
    if (children.length > 0) {
      childrenHtml = '<ul>';
      children.forEach(child => {
        childrenHtml += `<li>${compileHtmlForNode(child)}</li>`;
      });
      childrenHtml += '</ul>';
    }

    return `
      ${nodeHtml}
      ${childrenHtml}
    `;
  }

  // Render unified tree under virtual system root
  rootContainer.innerHTML = `<ul><li>${compileHtmlForNode(null, true)}</li></ul>`;
}

function toggleNodeCollapse(event, email) {
  event.stopPropagation();
  if (collapsedNodes.has(email)) {
    collapsedNodes.delete(email);
  } else {
    collapsedNodes.add(email);
  }
  renderReferralTree();
}

function getDownlineEmails(email) {
  const descendants = new Set();
  function recurse(currentEmail) {
    const children = users.filter(u => u.referred_by && u.referred_by.toLowerCase() === currentEmail.toLowerCase());
    children.forEach(child => {
      if (!descendants.has(child.email.toLowerCase())) {
        descendants.add(child.email.toLowerCase());
        recurse(child.email);
      }
    });
  }
  recurse(email);
  return Array.from(descendants);
}

function initiateNodeMove(event, userEmail) {
  if (event) event.stopPropagation();

  const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
  if (!user) return;

  const emailEl = document.getElementById('move-node-email');
  const selectEl = document.getElementById('move-node-select');
  const cancelBtn = document.getElementById('move-node-cancel-btn');
  const confirmBtn = document.getElementById('move-node-confirm-btn');
  const modal = document.getElementById('move-node-modal');

  if (!modal || !selectEl || !emailEl) return;

  emailEl.textContent = `${user.name} (${user.email})`;

  // Clear select options
  selectEl.innerHTML = '';

  // 1. Add "None (Move to System Root)"
  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = 'None (Move to System Root)';
  selectEl.appendChild(rootOption);

  // 2. Identify ineligible emails (self + descendants)
  const descendants = getDownlineEmails(userEmail);
  const ineligibleEmails = new Set(descendants);
  ineligibleEmails.add(userEmail.toLowerCase());

  // 3. Add other users as options
  users.forEach(otherUser => {
    if (!ineligibleEmails.has(otherUser.email.toLowerCase())) {
      const option = document.createElement('option');
      option.value = otherUser.email;
      // Pre-select if it's the current referred_by
      if (user.referred_by && user.referred_by.toLowerCase() === otherUser.email.toLowerCase()) {
        option.selected = true;
      }
      option.textContent = `${otherUser.name} (${otherUser.email})`;
      selectEl.appendChild(option);
    }
  });

  modal.style.display = 'flex';

  confirmBtn.onclick = async () => {
    const newReferrer = selectEl.value;
    modal.style.display = 'none';
    await updateNodeReferrer(userEmail, newReferrer);
  };

  cancelBtn.onclick = () => {
    modal.style.display = 'none';
  };
}

async function updateNodeReferrer(email, newReferrer) {
  try {
    const res = await fetch(`/api/admin/user/${encodeURIComponent(email)}/referrer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referred_by: newReferrer || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update referrer');

    showNotification(data.message || 'Client referrer updated successfully.', 'success');
    await initDatabase();
    await loadAdminPortalData();
    if (activeAdminTab === 'tree') {
      renderReferralTree();
    }
  } catch (err) {
    console.warn('API error, trying LocalStorage fallback:', err.message);

    // Fallback logic
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      const oldReferrer = user.referred_by;
      user.referred_by = newReferrer || null;
      saveDatabase();
      logSystemEvent('ClientReferrerUpdated', {
        email: email.toLowerCase(),
        old_referred_by: oldReferrer,
        new_referred_by: newReferrer || null
      });
      showNotification('Client referrer updated (Local).', 'success');
      loadAdminPortalData();
      if (activeAdminTab === 'tree') {
        renderReferralTree();
      }
    }
  }
}


/* ==========================================================================
   PAN & ZOOM CANVAS LOGIC
   ========================================================================== */

function initPanZoom() {
  const viewport = document.getElementById('tree-viewport');
  const canvas = document.getElementById('tree-canvas');
  if (!viewport || !canvas) return;

  // Apply default scale/pos on canvas
  updateTransform();

  viewport.onmousedown = (e) => {
    // Only drag if not clicking on tree node cards or zoom buttons
    if (e.target.closest('.tree-node') || e.target.closest('.control-btn')) {
      return;
    }
    isPanning = true;
    viewport.classList.add('grabbing');
    panStart = { x: e.clientX - transformState.x, y: e.clientY - transformState.y };
  };

  window.onmousemove = (e) => {
    if (!isPanning) return;
    transformState.x = e.clientX - panStart.x;
    transformState.y = e.clientY - panStart.y;
    updateTransform();
  };

  window.onmouseup = () => {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove('grabbing');
    }
  };

  viewport.onwheel = (e) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    const delta = e.deltaY < 0 ? 1 : -1;
    adjustZoom(delta * zoomFactor, e.clientX, e.clientY);
  };
}

function updateTransform() {
  const canvas = document.getElementById('tree-canvas');
  if (canvas) {
    canvas.style.transform = `translate(${transformState.x}px, ${transformState.y}px) scale(${transformState.scale})`;
  }
}

function adjustZoom(delta, clientX, clientY) {
  const viewport = document.getElementById('tree-viewport');
  if (!viewport) return;

  const rect = viewport.getBoundingClientRect();
  
  // Center of viewport by default
  let targetX = rect.width / 2;
  let targetY = rect.height / 2;

  // If client coordinate is provided (mouse scroll)
  if (clientX !== undefined && clientY !== undefined) {
    targetX = clientX - rect.left;
    targetY = clientY - rect.top;
  }

  const oldScale = transformState.scale;
  let newScale = oldScale + delta;
  
  // Scale boundaries
  newScale = Math.max(0.15, Math.min(3.0, newScale));

  const scaleRatio = newScale / oldScale;
  transformState.x = targetX - (targetX - transformState.x) * scaleRatio;
  transformState.y = targetY - (targetY - transformState.y) * scaleRatio;
  transformState.scale = newScale;

  updateTransform();
}

function resetPanZoom() {
  const viewport = document.getElementById('tree-viewport');
  if (!viewport) return;

  const rect = viewport.getBoundingClientRect();
  transformState.scale = 0.75;
  transformState.x = (rect.width - 200 * transformState.scale) / 2; // Center horizontally
  transformState.y = 40; // Align near top
  
  updateTransform();
}

async function loadSystemSettings() {
  try {
    if (useBackend) {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        systemSettings = await res.json();
      }
    } else {
      systemSettings = JSON.parse(localStorage.getItem('gbd_settings_v4')) || systemSettings;
    }
    
    // Update UI elements
    const discountEnabledEl = document.getElementById('settings-discount-enabled');
    const discountPercentEl = document.getElementById('settings-discount-percent');
    const commissionEnabledEl = document.getElementById('settings-commission-enabled');
    const commissionAmountEl = document.getElementById('settings-commission-amount');

    if (discountEnabledEl) discountEnabledEl.checked = !!systemSettings.friend_discount_enabled;
    if (discountPercentEl) discountPercentEl.value = systemSettings.friend_discount_percent || 0;
    if (commissionEnabledEl) commissionEnabledEl.checked = !!systemSettings.commission_enabled;
    if (commissionAmountEl) commissionAmountEl.value = systemSettings.commission_amount || 0;
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSystemSettings() {
  const discountEnabled = document.getElementById('settings-discount-enabled').checked;
  const discountPercent = parseInt(document.getElementById('settings-discount-percent').value, 10) || 0;
  const commissionEnabled = document.getElementById('settings-commission-enabled').checked;
  const commissionAmount = parseFloat(document.getElementById('settings-commission-amount').value) || 0;

  const newSettings = {
    friend_discount_enabled: discountEnabled,
    friend_discount_percent: discountPercent,
    commission_enabled: commissionEnabled,
    commission_amount: commissionAmount
  };

  try {
    if (useBackend) {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      showNotification(data.message || 'Settings saved.', 'success');
    } else {
      systemSettings = newSettings;
      saveDatabase();
      showNotification('Settings saved (Local).', 'success');
    }
    
    // Reload database to sync settings memory
    await initDatabase();
    
  } catch (err) {
    console.error('Failed to save settings:', err);
    showNotification('Failed to save settings.', 'error');
  }
}

// ==========================================================================
// ADMIN BATCH CONFIGURATION CONTROLLERS
// ==========================================================================

async function loadBatchSchedules() {
  try {
    let batches = [];
    let settingsData = {};
    
    if (useBackend) {
      const [batchesRes, settingsRes] = await Promise.all([
        fetch('/api/batches'),
        fetch('/api/admin/settings')
      ]);
      const batchesData = await batchesRes.json();
      
      if (!batchesRes.ok || !batchesData.success) throw new Error(batchesData.error || 'Failed to fetch batches');
      batches = batchesData.batches;
      
      if (settingsRes.ok) {
        settingsData = await settingsRes.json();
      }
    } else {
      batches = JSON.parse(localStorage.getItem('gbd_batches_v4')) || [
        { id: 1, name: 'Old Big Sister', code: 'OLD_BIG_SISTER', masterclass_date: '2026-06-20T19:00', registration_date: '2026-06-21T19:00', gap_date: '2026-06-22T19:00', bridge_date: '2026-06-24T19:00' },
        { id: 2, name: 'New Big Sister', code: 'NEW_BIG_SISTER', masterclass_date: '2026-06-22T19:00', registration_date: '2026-06-23T19:00', gap_date: '2026-06-24T19:00', bridge_date: '2026-06-26T19:00' },
        { id: 3, name: 'SS Certified', code: 'SS_CERTIFIED', masterclass_date: '2026-06-24T19:00', registration_date: '2026-06-25T19:00', gap_date: '2026-06-26T19:00', bridge_date: '2026-06-28T19:00' }
      ];
      settingsData = JSON.parse(localStorage.getItem('gbd_settings_v4')) || {};
    }
    
    batches.forEach(b => {
      const masterclassInput = document.getElementById(`batch-${b.id}-masterclass`);
      const registrationInput = document.getElementById(`batch-${b.id}-registration`);
      const gapInput = document.getElementById(`batch-${b.id}-gap`);
      const bridgeInput = document.getElementById(`batch-${b.id}-bridge`);
      const gapActiveInput = document.getElementById(`batch-${b.id}-gap-active`);
      const gapPaymentActiveInput = document.getElementById(`batch-${b.id}-payment-active`);
      
      if (masterclassInput) {
        masterclassInput.value = formatDateTimeLocalInput(b.masterclass_date);
      }
      if (registrationInput) {
        registrationInput.value = formatDateTimeLocalInput(b.registration_date);
      }
      if (gapInput) {
        gapInput.value = formatDateTimeLocalInput(b.gap_date);
      }
      if (bridgeInput) {
        bridgeInput.value = formatDateTimeLocalInput(b.bridge_date);
      }
      if (gapActiveInput) {
        gapActiveInput.checked = settingsData[`gap_page_active_${b.id}`] !== false;
      }
      if (gapPaymentActiveInput) {
        gapPaymentActiveInput.checked = settingsData[`gap_payment_active_${b.id}`] === true;
      }
    });
  } catch (err) {
    console.error('Failed to load batch schedules:', err);
  }
}

function formatDateTimeLocalInput(dateStr) {
  if (!dateStr || dateStr === 'Pending') return '';
  if (dateStr.includes('T')) {
    return dateStr.slice(0, 16);
  }
  if (dateStr.includes(' ')) {
    return dateStr.replace(' ', 'T').slice(0, 16);
  }
  return `${dateStr}T19:00`;
}

async function saveAdminBatchSchedule(batchId) {
  const masterclassVal = document.getElementById(`batch-${batchId}-masterclass`).value;
  const registrationVal = document.getElementById(`batch-${batchId}-registration`).value;
  const gapVal = document.getElementById(`batch-${batchId}-gap`).value;
  const bridgeVal = document.getElementById(`batch-${batchId}-bridge`).value;
  
  const cascadeCheckbox = document.getElementById(`batch-${batchId}-cascade`);
  const cascade = cascadeCheckbox ? cascadeCheckbox.checked : false;

  const gapActiveCheckbox = document.getElementById(`batch-${batchId}-gap-active`);
  const gapPageActive = gapActiveCheckbox ? gapActiveCheckbox.checked : false;

  const gapPaymentActiveCheckbox = document.getElementById(`batch-${batchId}-payment-active`);
  const gapPaymentActive = gapPaymentActiveCheckbox ? gapPaymentActiveCheckbox.checked : false;
  
  if (useBackend) {
    const payload = {
      batchId: batchId,
      masterclassDate: masterclassVal,
      registrationDate: registrationVal,
      gapDate: gapVal,
      bridgeDate: bridgeVal,
      cascade: cascade,
      gapPageActive: gapPageActive,
      gapPaymentActive: gapPaymentActive
    };
    
    try {
      const res = await fetch('/api/admin/change-batch-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update batch dates');
      
      showNotification(data.message || 'Batch dates updated successfully.', 'success');
      await loadBatchSchedules();
    } catch (err) {
      console.error('Failed to save batch schedule:', err);
      showNotification(err.message || 'Failed to save batch schedule.', 'error');
    }
  } else {
    try {
      let batches = JSON.parse(localStorage.getItem('gbd_batches_v4')) || [
        { id: 1, name: 'Old Big Sister', code: 'OLD_BIG_SISTER', masterclass_date: '2026-06-20T19:00', registration_date: '2026-06-21T19:00', gap_date: '2026-06-22T19:00', bridge_date: '2026-06-24T19:00' },
        { id: 2, name: 'New Big Sister', code: 'NEW_BIG_SISTER', masterclass_date: '2026-06-22T19:00', registration_date: '2026-06-23T19:00', gap_date: '2026-06-24T19:00', bridge_date: '2026-06-26T19:00' },
        { id: 3, name: 'SS Certified', code: 'SS_CERTIFIED', masterclass_date: '2026-06-24T19:00', registration_date: '2026-06-25T19:00', gap_date: '2026-06-26T19:00', bridge_date: '2026-06-28T19:00' }
      ];
      
      const batchIdx = batches.findIndex(b => b.id === batchId);
      if (batchIdx !== -1) {
        batches[batchIdx].masterclass_date = masterclassVal || batches[batchIdx].masterclass_date;
        batches[batchIdx].registration_date = registrationVal || batches[batchIdx].registration_date;
        batches[batchIdx].gap_date = gapVal || batches[batchIdx].gap_date;
        batches[batchIdx].bridge_date = bridgeVal || batches[batchIdx].bridge_date;
      }
      
      if (cascade && masterclassVal) {
        const dateObj = new Date(masterclassVal);
        const code = batches[batchIdx] ? batches[batchIdx].code : '';
        
        if (code === 'OLD_BIG_SISTER') {
          const nbsDate = new Date(dateObj);
          nbsDate.setDate(dateObj.getDate() + 2);
          const nbsDateStr = nbsDate.toISOString().split('T')[0];
          
          const sscDate = new Date(dateObj);
          sscDate.setDate(dateObj.getDate() + 4);
          const sscDateStr = sscDate.toISOString().split('T')[0];
          
          const nbsIdx = batches.findIndex(b => b.code === 'NEW_BIG_SISTER');
          if (nbsIdx !== -1) {
            batches[nbsIdx].masterclass_date = nbsDateStr;
            batches[nbsIdx].registration_date = nbsDateStr;
            batches[nbsIdx].gap_date = nbsDateStr;
            batches[nbsIdx].bridge_date = nbsDateStr;
          }
          
          const sscIdx = batches.findIndex(b => b.code === 'SS_CERTIFIED');
          if (sscIdx !== -1) {
            batches[sscIdx].masterclass_date = sscDateStr;
            batches[sscIdx].registration_date = sscDateStr;
            batches[sscIdx].gap_date = sscDateStr;
            batches[sscIdx].bridge_date = sscDateStr;
          }
        } else if (code === 'NEW_BIG_SISTER') {
          const sscDate = new Date(dateObj);
          sscDate.setDate(dateObj.getDate() + 2);
          const sscDateStr = sscDate.toISOString().split('T')[0];
          
          const sscIdx = batches.findIndex(b => b.code === 'SS_CERTIFIED');
          if (sscIdx !== -1) {
            batches[sscIdx].masterclass_date = sscDateStr;
            batches[sscIdx].registration_date = sscDateStr;
            batches[sscIdx].gap_date = sscDateStr;
            batches[sscIdx].bridge_date = sscDateStr;
          }
        }
      }
      
      localStorage.setItem('gbd_batches_v4', JSON.stringify(batches));
      
      let settings = JSON.parse(localStorage.getItem('gbd_settings_v4')) || {};
      settings[`gap_page_active_${batchId}`] = gapPageActive;
      settings[`gap_payment_active_${batchId}`] = gapPaymentActive;
      localStorage.setItem('gbd_settings_v4', JSON.stringify(settings));
      
      if (currentUser && (currentUser.batch_id || 1) === batchId) {
        const mockGating = resolveMockUserGating(currentUser);
        currentUser.gap_page_active = mockGating.gapPageActive;
        currentUser.gap_payment_active = mockGating.gapPaymentActive;
        localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
        
        const userIdx = users.findIndex(u => u.email === currentUser.email);
        if (userIdx !== -1) {
          users[userIdx].gap_page_active = mockGating.gapPageActive;
          users[userIdx].gap_payment_active = mockGating.gapPaymentActive;
          localStorage.setItem('gbd_users_v4', JSON.stringify(users));
        }
        
        resolveClientPortalView();
      }
      
      showNotification('Batch dates and settings updated locally.', 'success');
      await loadBatchSchedules();
    } catch (err) {
      console.error('Failed to save batch schedule locally:', err);
      showNotification(err.message || 'Failed to save batch schedule locally.', 'error');
    }
  }
}

// ==========================================================================
// MIGRATION LANDING & POPUP CONTROLLERS
// ==========================================================================

function formatMasterclassDate(dateStr) {
  if (!dateStr || dateStr === 'Pending') return 'Date Pending';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const optionsDay = { weekday: 'long' };
    const dayName = date.toLocaleDateString('en-US', optionsDay);
    
    const optionsMonth = { month: 'long' };
    const monthName = date.toLocaleDateString('en-US', optionsMonth);
    
    const dayNum = date.getDate();
    const year = date.getFullYear();
    
    let suffix = 'th';
    if (dayNum === 1 || dayNum === 21 || dayNum === 31) suffix = 'st';
    else if (dayNum === 2 || dayNum === 22) suffix = 'nd';
    else if (dayNum === 3 || dayNum === 23) suffix = 'rd';
    
    return `${dayNum}${suffix} ${monthName} ${year}, ${dayName}`;
  } catch (e) {
    return dateStr;
  }
}

function formatMasterclassTime(dateStr) {
  if (!dateStr || dateStr === 'Pending') return '7:00 PM – 9:00 PM (IST)';
  try {
    if (!dateStr.includes('T') && !dateStr.includes(':')) {
      return '7:00 PM – 9:00 PM (IST)';
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '7:00 PM – 9:00 PM (IST)';
    }
    
    const optionsTime = { hour: 'numeric', minute: '2-digit', hour12: true };
    const formattedStart = date.toLocaleTimeString('en-US', optionsTime);
    
    const endDate = new Date(date.getTime() + 2 * 60 * 60 * 1000);
    const formattedEnd = endDate.toLocaleTimeString('en-US', optionsTime);
    
    return `${formattedStart} – ${formattedEnd} (IST)`;
  } catch (e) {
    return '7:00 PM – 9:00 PM (IST)';
  }
}

function showMasterclassPopup() {
  const popup = document.getElementById('masterclass-popup');
  if (popup) {
    const dateEl = document.getElementById('masterclass-popup-date');
    const timeEl = document.getElementById('masterclass-popup-time');
    
    if (currentUser && currentUser.masterclass_date && dateEl && timeEl) {
      dateEl.textContent = formatMasterclassDate(currentUser.masterclass_date);
      timeEl.textContent = formatMasterclassTime(currentUser.masterclass_date);
    }
    
    // Dynamic updates for status button and footer text
    const statusBtn = document.getElementById('masterclass-popup-status-btn');
    const statusText = document.getElementById('masterclass-popup-status-text');
    const footerText = document.getElementById('masterclass-popup-footer-text');
    
    if (statusBtn && statusText && footerText && currentUser) {
      const stage = currentUser.current_stage || 'INVITED';
      if (stage === 'REGISTRATION') {
        if (currentUser.gap_page_active) {
          statusText.textContent = 'PROCEED TO GAP PAGE';
          footerText.innerHTML = 'Your masterclass attendance is verified.<br>Click above or close this popup to view the GAP page.';
          statusBtn.style.background = 'var(--accent, #e5a93b)';
          statusBtn.style.cursor = 'pointer';
          statusBtn.onclick = () => {
            closeMasterclassPopup();
            resolveClientPortalView();
          };
        } else {
          statusText.textContent = 'ATTENDANCE VERIFIED';
          footerText.innerHTML = 'Your masterclass attendance is verified.<br>The Gap details page will be activated shortly by the admin.';
          statusBtn.style.background = 'var(--secondary, #28a745)';
          statusBtn.style.cursor = 'default';
          statusBtn.onclick = null;
        }
      } else {
        // Default / Invited / Masterclass stage
        statusText.textContent = 'RESERVED FOR YOUR MASTERCLASS';
        footerText.innerHTML = 'You are registered.<br>All the details are already in place.';
        statusBtn.style.background = ''; // default CSS style
        statusBtn.style.cursor = 'default';
        statusBtn.onclick = null;
      }
    }
    
    popup.style.display = 'flex';
  }
}

function closeMasterclassPopup() {
  const popup = document.getElementById('masterclass-popup');
  if (popup) popup.style.display = 'none';
}

function proceedToDashboard() {
  closeMasterclassPopup();
  document.getElementById('migration-landing-panel').style.display = 'none';
  document.getElementById('portal-panel').style.display = 'block';
  switchTab('referral');
}

function showGapRegistrationPopup() {
  const popup = document.getElementById('gap-registration-popup');
  if (popup) {
    const step1 = document.getElementById('gap-reg-step1');
    const step2 = document.getElementById('gap-reg-step2');

    if (currentUser && currentUser.current_stage === 'GAP') {
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = 'block';

      // Populate session details inside modal
      const gapDateEl = document.getElementById('gap-popup-date');
      const gapTimeEl = document.getElementById('gap-popup-time');
      if (gapDateEl && currentUser.gap_date) {
        gapDateEl.textContent = formatMasterclassDate(currentUser.gap_date);
      }
      if (gapTimeEl && currentUser.gap_date) {
        gapTimeEl.textContent = formatMasterclassTime(currentUser.gap_date);
      }
    } else {
      if (step1) step1.style.display = 'block';
      if (step2) step2.style.display = 'none';

      const nameInput = document.getElementById('gap-reg-name');
      const emailInput = document.getElementById('gap-reg-email');
      const phoneInput = document.getElementById('gap-reg-phone');

      if (currentUser) {
        if (nameInput) nameInput.value = currentUser.name || '';
        if (emailInput) emailInput.value = currentUser.email || '';
        if (phoneInput) phoneInput.value = currentUser.phone || '';
      }
    }
    popup.style.display = 'flex';
  }
}

function closeGapRegistrationPopup() {
  const popup = document.getElementById('gap-registration-popup');
  if (popup) popup.style.display = 'none';
  
  if (currentUser && currentUser.current_stage === 'GAP') {
    // Rerender portal views
    resolveClientPortalView();
    renderCoursesCatalog();
    
    // Reset steps back to step 1
    const step1 = document.getElementById('gap-reg-step1');
    const step2 = document.getElementById('gap-reg-step2');
    if (step1 && step2) {
      step1.style.display = 'block';
      step2.style.display = 'none';
    }
  }
}

function finishGapRegistration() {
  closeGapRegistrationPopup();
}

async function submitGapRegistration(event) {
  event.preventDefault();
  console.log('Gap registration form submitted.');
  const nameEl = document.getElementById('gap-reg-name');
  const phoneEl = document.getElementById('gap-reg-phone');

  if (!nameEl || !phoneEl) {
    console.error('Gap registration inputs not found in DOM.');
    showNotification('Registration inputs missing. Please refresh and try again.', 'error');
    return;
  }

  const name = nameEl.value;
  const phone = phoneEl.value;
  console.log('Submitting data:', { name, phone });

  if (useBackend) {
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete registration');

      console.log('Registration success response:', data);
      showNotification('Registration completed! Welcome to the GAP Program.', 'success');

      // Update locally
      if (!currentUser) {
        currentUser = { name, phone, email: document.getElementById('gap-reg-email')?.value || '' };
      } else {
        currentUser.name = name || currentUser.name;
        currentUser.phone = phone || currentUser.phone;
      }
      currentUser.current_stage = 'GAP';
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      console.log('Session updated locally:', currentUser);
      
      const step1 = document.getElementById('gap-reg-step1');
      const step2 = document.getElementById('gap-reg-step2');
      if (step1 && step2) {
        step1.style.display = 'none';
        step2.style.display = 'block';
        console.log('Switched to Step 2 details view.');
      }
      
      // Populate session details inside modal
      const gapDateEl = document.getElementById('gap-popup-date');
      const gapTimeEl = document.getElementById('gap-popup-time');
      if (gapDateEl && currentUser.gap_date) {
        gapDateEl.textContent = formatMasterclassDate(currentUser.gap_date);
      }
      if (gapTimeEl && currentUser.gap_date) {
        gapTimeEl.textContent = formatMasterclassTime(currentUser.gap_date);
      }
    } catch (err) {
      console.error('Gap registration submit error:', err);
      showNotification(err.message || 'Failed to complete registration', 'error');
    }
  } else {
    try {
      if (!currentUser) {
        currentUser = { name, phone, email: document.getElementById('gap-reg-email')?.value || '' };
      } else {
        currentUser.name = name || currentUser.name;
        currentUser.phone = phone || currentUser.phone;
      }
      currentUser.current_stage = 'GAP';
      
      const userIdx = users.findIndex(u => u.email === currentUser.email);
      if (userIdx !== -1) {
        users[userIdx].name = currentUser.name;
        users[userIdx].phone = currentUser.phone;
        users[userIdx].current_stage = 'GAP';
        localStorage.setItem('gbd_users_v4', JSON.stringify(users));
      }
      
      const mockGating = resolveMockUserGating(currentUser);
      currentUser.gap_page_active = mockGating.gapPageActive;
      currentUser.gap_payment_active = mockGating.gapPaymentActive;
      
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      console.log('Session updated locally (simulation mode):', currentUser);
      
      showNotification('Registration completed! Welcome to the GAP Program.', 'success');
      
      const step1 = document.getElementById('gap-reg-step1');
      const step2 = document.getElementById('gap-reg-step2');
      if (step1 && step2) {
        step1.style.display = 'none';
        step2.style.display = 'block';
        console.log('Switched to Step 2 details view.');
      }
      
      const gapDateEl = document.getElementById('gap-popup-date');
      const gapTimeEl = document.getElementById('gap-popup-time');
      if (gapDateEl && currentUser.gap_date) {
        gapDateEl.textContent = formatMasterclassDate(currentUser.gap_date);
      }
      if (gapTimeEl && currentUser.gap_date) {
        gapTimeEl.textContent = formatMasterclassTime(currentUser.gap_date);
      }
      
      resolveClientPortalView();
    } catch (err) {
      console.error('Gap registration submit local error:', err);
      showNotification('Failed to complete registration locally', 'error');
    }
  }
}
