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
let activeTab = 'courses';
let authMode = 'login'; // 'login' or 'register'
let editingClientEmail = null;
let editingAffiliateCode = null;
let allSignups = [];
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

// Initialize Database and handle async startup
document.addEventListener('DOMContentLoaded', async () => {
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
          } else if (userRes.status === 404) {
            try {
              const errData = await userRes.json();
              if (errData && errData.error === 'User not found.') {
                localStorage.removeItem('gbd_current_user');
                currentUser = null;
                if (isClientPage) {
                  location.reload();
                }
              }
            } catch (jsonErr) {
              console.warn('Non-JSON 404 response from users/me (possibly route not ready), skipping logout.');
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
          localStorage.setItem('gbd_active_referrer_name', data.referrerName);
          localStorage.setItem('gbd_active_coupon_code', data.couponCode);
          
          // Show banner
          document.getElementById('referred-banner').style.display = 'block';
          document.getElementById('referred-banner-text').innerHTML = `You were referred by <strong>${data.referrerName}</strong>. Apply their coupon code <code>${data.couponCode}</code> at checkout to save 10%!`;
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

        // Show banner
        document.getElementById('referred-banner').style.display = 'block';
        document.getElementById('referred-banner-text').innerHTML = `You were referred by <strong>${referrerName}</strong>. Apply their coupon code <code>${referrerProfile.coupon_code}</code> at checkout to save 10%!`;
        
        // Clean query params from URL bar
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  } else {
    // Check if there is an active referral cookie in storage
    const activeRef = localStorage.getItem('gbd_active_referral');
    if (activeRef) {
      if (useBackend) {
        const cachedName = localStorage.getItem('gbd_active_referrer_name');
        const cachedCoupon = localStorage.getItem('gbd_active_coupon_code');
        if (cachedName && cachedCoupon) {
          document.getElementById('referred-banner').style.display = 'block';
          document.getElementById('referred-banner-text').innerHTML = `You were referred by <strong>${cachedName}</strong>. Apply their coupon code <code>${cachedCoupon}</code> at checkout to save 10%!`;
        } else {
          fetch(`/api/referrals/lookup?code=${encodeURIComponent(activeRef)}`)
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                localStorage.setItem('gbd_active_referrer_name', data.name);
                localStorage.setItem('gbd_active_coupon_code', data.coupon_code);
                document.getElementById('referred-banner').style.display = 'block';
                document.getElementById('referred-banner-text').innerHTML = `You were referred by <strong>${data.name}</strong>. Apply their coupon code <code>${data.coupon_code}</code> at checkout to save 10%!`;
              }
            })
            .catch(err => console.warn('Referral lookup failed:', err));
        }
      } else {
        const referrerProfile = referralProfiles.find(r => r.affiliate_code === activeRef);
        if (referrerProfile) {
          const referrerUser = users.find(u => u.email === referrerProfile.email);
          const referrerName = referrerUser ? referrerUser.name : 'Unknown User';
          document.getElementById('referred-banner').style.display = 'block';
          document.getElementById('referred-banner-text').innerHTML = `You were referred by <strong>${referrerName}</strong>. Apply their coupon code <code>${referrerProfile.coupon_code}</code> at checkout to save 10%!`;
        }
      }
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
    
    document.getElementById('portal-panel').style.display = 'block';
    document.getElementById('welcome-message').textContent = `Logged in as: ${currentUser.name}`;
    switchTab('courses');
  } else {
    document.getElementById('auth-panel').style.display = 'block';
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
  const banner = document.getElementById('notification-banner');
  const msgEl = document.getElementById('notification-message');
  const iconEl = document.getElementById('notification-icon');
  
  if (!banner || !msgEl || !iconEl) return;
  
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
    banner.style.backgroundColor = 'rgba(75, 46, 43, 0.05)';
    banner.style.borderColor = 'rgba(75, 46, 43, 0.25)';
    banner.style.color = 'var(--primary)';
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

// Toggle authentication forms
function toggleAuthMode(mode) {
  authMode = mode;
  const loginBtn = document.getElementById('btn-auth-tab-login');
  const regBtn = document.getElementById('btn-auth-tab-register');
  const regFields = document.getElementById('register-fields');
  const submitBtn = document.getElementById('btn-auth-submit');
  const errBox = document.getElementById('auth-error');

  errBox.style.display = 'none';

  if (mode === 'login') {
    loginBtn.classList.add('active');
    regBtn.classList.remove('active');
    regFields.style.display = 'none';
    submitBtn.textContent = 'Sign In';
  } else {
    loginBtn.classList.remove('active');
    regBtn.classList.add('active');
    regFields.style.display = 'block';
    submitBtn.textContent = 'Create Account';
    
    // Autofill referral field if we have an active referral code
    const activeRef = localStorage.getItem('gbd_active_referral');
    const refInput = document.getElementById('auth-referral');
    if (activeRef && refInput && !refInput.value) {
      refInput.value = activeRef;
    }
  }
}

// Process login/registration submit
async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const name = document.getElementById('auth-name').value.trim();
  const errBox = document.getElementById('auth-error');

  errBox.style.display = 'none';

  if (!email || !password || (authMode === 'register' && !name)) {
    errBox.textContent = 'Please fill out all required fields.';
    errBox.style.display = 'block';
    return;
  }

  try {
    if (authMode === 'login') {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      currentUser = data.user;
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      document.getElementById('auth-panel').style.display = 'none';
      document.getElementById('portal-panel').style.display = 'block';
      document.getElementById('welcome-message').textContent = `Logged in as: ${currentUser.name}`;
      
      document.getElementById('auth-email').value = '';
      document.getElementById('auth-password').value = '';
      switchTab('courses');
    } else {
      const referralCode = document.getElementById('auth-referral') ? document.getElementById('auth-referral').value.trim().toUpperCase() : '';
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, referralCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      
      currentUser = data.user;
      localStorage.setItem('gbd_current_user', JSON.stringify(currentUser));
      document.getElementById('auth-panel').style.display = 'none';
      document.getElementById('portal-panel').style.display = 'block';
      document.getElementById('welcome-message').textContent = `Logged in as: ${currentUser.name}`;
      
      document.getElementById('auth-name').value = '';
      document.getElementById('auth-email').value = '';
      document.getElementById('auth-password').value = '';
      if (document.getElementById('auth-referral')) {
        document.getElementById('auth-referral').value = '';
      }
      switchTab('courses');
    }
    // Reload state from server
    await initDatabase();
  } catch (apiErr) {
    console.warn('Auth API error, trying LocalStorage fallback:', apiErr.message);

    if (authMode === 'login') {
      // Process login
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        errBox.textContent = 'No account found with this email.';
        errBox.style.display = 'block';
        return;
      }

      if (user.password !== password) {
        errBox.textContent = 'Incorrect password.';
        errBox.style.display = 'block';
        return;
      }

      // Success
      currentUser = user;
      localStorage.setItem('gbd_current_user', JSON.stringify(user));
      document.getElementById('auth-panel').style.display = 'none';
      document.getElementById('portal-panel').style.display = 'block';
      document.getElementById('welcome-message').textContent = `Logged in as: ${user.name}`;
      
      // Clear inputs
      document.getElementById('auth-email').value = '';
      document.getElementById('auth-password').value = '';

      switchTab('courses');

    } else {
      // Process registration
      const referralCode = document.getElementById('auth-referral') ? document.getElementById('auth-referral').value.trim().toUpperCase() : '';
      
      const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        errBox.textContent = 'An account with this email already exists.';
        errBox.style.display = 'block';
        return;
      }

      let referred_by = null;
      if (referralCode) {
        const cleanCode = referralCode.replace(/-OFF$/, '');
        const referrerProfile = referralProfiles.find(r => r.affiliate_code.toUpperCase() === cleanCode);
        if (referrerProfile) {
          referred_by = referrerProfile.email.toLowerCase();
          if (referred_by === email.toLowerCase()) {
            errBox.textContent = 'You cannot refer yourself.';
            errBox.style.display = 'block';
            return;
          }
        } else {
          errBox.textContent = 'Invalid referral code.';
          errBox.style.display = 'block';
          return;
        }
      }

      // Generate unique code (e.g. CON2991)
      const cleanName = name.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
      const randNum = Math.floor(1000 + Math.random() * 9000);
      const affiliateCode = `${cleanName}${randNum}`;
      const couponCode = `${affiliateCode}-OFF`;

      const newUser = {
        name,
        email,
        password,
        purchased_courses: [],
        referred_by: referred_by
      };

      const newReferral = {
        email,
        affiliate_code: affiliateCode,
        coupon_code: couponCode,
        referrals_count: 0,
        earnings: 0.00
      };

      users.push(newUser);
      referralProfiles.push(newReferral);
      saveDatabase();

      logSystemEvent('AffiliateRegistered', {
        name: newUser.name,
        email: newUser.email,
        affiliate_code: newReferral.affiliate_code,
        coupon_code: newReferral.coupon_code,
        referred_by: referred_by
      });

      currentUser = newUser;
      localStorage.setItem('gbd_current_user', JSON.stringify(newUser));
      document.getElementById('auth-panel').style.display = 'none';
      document.getElementById('portal-panel').style.display = 'block';
      document.getElementById('welcome-message').textContent = `Logged in as: ${newUser.name}`;

      // Clear inputs
      document.getElementById('auth-name').value = '';
      document.getElementById('auth-email').value = '';
      document.getElementById('auth-password').value = '';
      if (document.getElementById('auth-referral')) {
        document.getElementById('auth-referral').value = '';
      }

      switchTab('courses');
    }
  }
}
// Log out active session
function logoutUser() {
  localStorage.removeItem('gbd_current_user');
  currentUser = null;
  cart = [];
  document.getElementById('portal-panel').style.display = 'none';
  document.getElementById('auth-panel').style.display = 'block';
}

// Switch tabs inside portal
function switchTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
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
  document.querySelectorAll('.course-card').forEach((card, index) => {
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
      
      // Update referred-banner if present
      const banner = document.getElementById('referred-banner');
      const bannerText = document.getElementById('referred-banner-text');
      if (banner && bannerText) {
        banner.style.display = 'block';
        bannerText.innerHTML = `You were referred by <strong>${match.name}</strong>. Apply their coupon code <code>${match.coupon_code}</code> at checkout to save 10%!`;
      }
      
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
      
      // Update referred-banner if present
      const banner = document.getElementById('referred-banner');
      const bannerText = document.getElementById('referred-banner-text');
      if (banner && bannerText) {
        banner.style.display = 'block';
        bannerText.innerHTML = `You were referred by <strong>${referrerName}</strong>. Apply their coupon code <code>${match.coupon_code}</code> at checkout to save 10%!`;
      }
      
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

function initAdminPortal() {
  loadAdminPortalData();
  // Poll localStorage database changes every 2 seconds
  adminPollInterval = setInterval(loadAdminPortalData, 2000);
}

async function loadAdminPortalData() {
  try {
    const res = await fetch('/api/admin/data');
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    users = data.users || [];
    referralProfiles = data.affiliates || [];
    clicks = data.clicks || [];
    signups = data.signups || [];
    allSignups = data.allSignups || [];
    eventLogs = data.events || [];
  } catch (err) {
    console.warn('Backend server offline during polling, reading from LocalStorage:', err.message);
    // Re-read arrays from localstorage
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

function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);">No client accounts registered.</td></tr>`;
    return;
  }

  const coursesMapping = {
    1: 'Python Web Masterclass',
    2: 'JavaScript Deep Dive',
    3: 'Divine Creator Community'
  };

  users.forEach(u => {
    const enrolled = u.purchased_courses || [];
    const courseNames = enrolled.map(cid => coursesMapping[cid] || `Course ${cid}`).join(', ') || 'None';
    
    if (u.email === editingClientEmail) {
      tbody.innerHTML += `
        <tr>
          <td><input type="text" id="edit-client-name-${u.email}" value="${u.name}" class="input-sm"></td>
          <td>${u.email}</td>
          <td><input type="text" id="edit-client-password-${u.email}" value="${u.password}" class="input-sm" style="font-family: var(--font-mono);"></td>
          <td style="color: var(--text-muted); font-size: 0.9rem;">${courseNames}</td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-success btn-sm" onclick="saveClientEdit('${u.email}')">Save</button>
              <button class="btn btn-secondary btn-sm" onclick="cancelClientEdit()">Cancel</button>
            </div>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML += `
        <tr>
          <td style="font-weight: 600; color: var(--text-main);">${u.name}</td>
          <td>${u.email}</td>
          <td><code style="color: var(--primary);">${u.password}</code></td>
          <td style="color: var(--text-muted); font-size: 0.9rem;">${courseNames}</td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" onclick="editClient('${u.email}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteClient('${u.email}')" style="background-color: var(--danger); border-color: var(--danger);">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }
  });
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
          <td><code style="color: var(--primary); font-weight: bold;">${profile.affiliate_code}</code></td>
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

function editClient(email) {
  editingClientEmail = email;
  renderAdminUsersTable();
}

function cancelClientEdit() {
  editingClientEmail = null;
  renderAdminUsersTable();
}

async function saveClientEdit(email) {
  const nameInput = document.getElementById(`edit-client-name-${email}`);
  const pwdInput = document.getElementById(`edit-client-password-${email}`);
  if (!nameInput || !pwdInput) return;

  const newName = nameInput.value.trim();
  const newPassword = pwdInput.value.trim();

  if (newName === '' || newPassword === '') {
    showNotification('Name and Password cannot be empty.', 'error');
    return;
  }

  const u = users.find(user => user.email.toLowerCase() === email.toLowerCase());
  if (!u) return;

  try {
    const res = await fetch(`/api/admin/user/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, password: newPassword, purchased_courses: u.purchased_courses })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update client');
    
    showNotification(data.message || 'Client account updated.', 'success');
    editingClientEmail = null;
    await initDatabase();
    loadAdminPortalData();
  } catch (err) {
    console.warn('API error, trying LocalStorage fallback:', err);
    u.name = newName;
    u.password = newPassword;
    
    // Sync name to affiliate profile if they have one
    const profile = referralProfiles.find(r => r.email.toLowerCase() === email.toLowerCase());
    if (profile) profile.name = newName;
    
    saveDatabase();
    showNotification('Client account updated (Local).', 'success');
    editingClientEmail = null;
    loadAdminPortalData();
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
  return user && user.referred_by ? user.referred_by.toLowerCase() : null;
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
