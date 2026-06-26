const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const isPostgres = !!postgresUrl;

let db;
let pool;
let initPromise = null;

if (isPostgres) {
  console.log('Connecting to PostgreSQL database...');
  pool = new Pool({
    connectionString: postgresUrl,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.log('Connecting to SQLite database...');
  const dbName = process.env.NODE_ENV === 'test' ? 'affiliates_test.db' : 'affiliates.db';
  const dbPath = path.join(__dirname, dbName);
  
  // Ensure database folder exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new sqlite3.Database(dbPath);
}

// Convert SQLite placeholders (?) to Postgres placeholders ($1, $2, etc.)
function convertSql(sql) {
  if (!isPostgres) return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Helper to run query in a promise
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      const pgSql = convertSql(sql);
      // SQLite INSERT returns id, Postgres can return it via RETURNING id
      let finalSql = pgSql;
      if (pgSql.trim().toUpperCase().startsWith('INSERT INTO')) {
        if (!pgSql.toUpperCase().includes('RETURNING') && !pgSql.toLowerCase().includes('system_settings')) {
          finalSql = `${pgSql} RETURNING id`;
        }
      }
      
      pool.query(finalSql, params, (err, res) => {
        if (err) return reject(err);
        const lastID = res.rows[0] ? res.rows[0].id : null;
        resolve({ id: lastID, changes: res.rowCount });
      });
    } else {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, changes: this.changes });
      });
    }
  });
}

// Helper to get a single row
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      pool.query(convertSql(sql), params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows[0] || null);
      });
    } else {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    }
  });
}

// Helper to get multiple rows
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      pool.query(convertSql(sql), params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows);
      });
    } else {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    }
  });
}

// Helper to log system events
async function logEvent(eventType, payload) {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  console.log(`[EVENT] ${eventType}:`, payloadStr);
  await run(
    'INSERT INTO event_logs (event_type, payload) VALUES (?, ?)',
    [eventType, payloadStr]
  );
}

// Helper to log audit changes
async function logAudit(actorId, action, tableName, recordId, oldValue, newValue) {
  const oldValStr = oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : null;
  const newValStr = newValue ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : null;
  console.log(`[AUDIT] ${action} on ${tableName} for record ${recordId} by actor ${actorId}`);
  await run(
    'INSERT INTO audit_logs (actor_id, action, table_name, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)',
    [actorId, action, tableName, recordId, oldValStr, newValStr]
  );
}

// Initialize database schema
async function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (isPostgres) {
    // System Settings Table
    await run(`CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(255) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    )`);

    // Batches Table
    await run(`CREATE TABLE IF NOT EXISTS batches (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(255) UNIQUE NOT NULL,
      masterclass_date VARCHAR(255),
      registration_date VARCHAR(255),
      gap_date VARCHAR(255),
      bridge_date VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE
    )`);

    // Users Table
    await run(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      current_stage VARCHAR(50) DEFAULT 'INVITED',
      is_active BOOLEAN DEFAULT TRUE,
      role VARCHAR(50) DEFAULT 'USER',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // User Progress Table
    await run(`CREATE TABLE IF NOT EXISTS user_progress (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      masterclass_attended BOOLEAN DEFAULT FALSE,
      registration_completed BOOLEAN DEFAULT FALSE,
      gap_completed BOOLEAN DEFAULT FALSE,
      payment_1_completed BOOLEAN DEFAULT FALSE,
      bridge_completed BOOLEAN DEFAULT FALSE,
      payment_2_completed BOOLEAN DEFAULT FALSE,
      certified BOOLEAN DEFAULT FALSE,
      partner_activated BOOLEAN DEFAULT FALSE
    )`);

    // Payments Table
    await run(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_type VARCHAR(50) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'INR',
      razorpay_order_id VARCHAR(255),
      razorpay_payment_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'Pending',
      invoice_url TEXT,
      receipt_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Notifications Table
    await run(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      channel VARCHAR(50) NOT NULL,
      subject VARCHAR(255),
      message TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      scheduled_at TIMESTAMP,
      sent_at TIMESTAMP
    )`);

    // Referrals Table
    await run(`CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referral_code VARCHAR(50) NOT NULL,
      parent_referral_id INTEGER REFERENCES referrals(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Earnings Table
    await run(`CREATE TABLE IF NOT EXISTS earnings (
      id SERIAL PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      earning_type VARCHAR(50) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Audit Logs Table
    await run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(255) NOT NULL,
      table_name VARCHAR(255) NOT NULL,
      record_id INTEGER NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Event Logs Table
    await run(`CREATE TABLE IF NOT EXISTS event_logs (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(255) NOT NULL,
      payload TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Affiliates Table
    await run(`CREATE TABLE IF NOT EXISTS affiliates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      affiliate_code VARCHAR(255) UNIQUE NOT NULL,
      coupon_code VARCHAR(255) UNIQUE NOT NULL
    )`);

    // Clicks Table
    await run(`CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
      ip_address VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Signups Table
    await run(`CREATE TABLE IF NOT EXISTS signups (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
      friend_email VARCHAR(255),
      commission_amount NUMERIC(12, 2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  } else {
    // Enable foreign keys in SQLite
    await run('PRAGMA foreign_keys = ON');

    // System Settings Table
    await run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    // Batches Table
    await run(`CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      masterclass_date TEXT,
      registration_date TEXT,
      gap_date TEXT,
      bridge_date TEXT,
      is_active INTEGER DEFAULT 1
    )`);

    // Users Table
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      batch_id INTEGER,
      current_stage TEXT DEFAULT 'INVITED',
      is_active INTEGER DEFAULT 1,
      role TEXT DEFAULT 'USER',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE SET NULL
    )`);

    // User Progress Table
    await run(`CREATE TABLE IF NOT EXISTS user_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      masterclass_attended INTEGER DEFAULT 0,
      registration_completed INTEGER DEFAULT 0,
      gap_completed INTEGER DEFAULT 0,
      payment_1_completed INTEGER DEFAULT 0,
      bridge_completed INTEGER DEFAULT 0,
      payment_2_completed INTEGER DEFAULT 0,
      certified INTEGER DEFAULT 0,
      partner_activated INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Payments Table
    await run(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      status TEXT DEFAULT 'Pending',
      invoice_url TEXT,
      receipt_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Notifications Table
    await run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      channel TEXT NOT NULL,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      scheduled_at TEXT,
      sent_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

    // Referrals Table
    await run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      student_id INTEGER UNIQUE NOT NULL,
      referral_code TEXT NOT NULL,
      parent_referral_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_referral_id) REFERENCES referrals(id) ON DELETE SET NULL
    )`);

    // Earnings Table
    await run(`CREATE TABLE IF NOT EXISTS earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL,
      earning_type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Audit Logs Table
    await run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

    // Event Logs Table
    await run(`CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Affiliates Table
    await run(`CREATE TABLE IF NOT EXISTS affiliates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      affiliate_code TEXT UNIQUE NOT NULL,
      coupon_code TEXT UNIQUE NOT NULL
    )`);

    // Clicks Table
    await run(`CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
    )`);

    // Signups Table
    await run(`CREATE TABLE IF NOT EXISTS signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER,
      friend_email TEXT,
      commission_amount REAL DEFAULT 0.00,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
    )`);
  }

    // Seed Data if Database is empty
    await seedDatabase();
  })();
  return initPromise;
}

async function getSetting(key, defaultValue = '') {
  try {
    const row = await get('SELECT value FROM system_settings WHERE key = ?', [key]);
    return row ? row.value : defaultValue;
  } catch (err) {
    console.warn(`Failed to get setting ${key}:`, err.message);
    return defaultValue;
  }
}

async function setSetting(key, value) {
  try {
    const row = await get('SELECT value FROM system_settings WHERE key = ?', [key]);
    if (row) {
      await run('UPDATE system_settings SET value = ? WHERE key = ?', [String(value), key]);
    } else {
      await run('INSERT INTO system_settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
  } catch (err) {
    console.error(`Failed to set setting ${key}:`, err.message);
  }
}

async function seedDatabase() {
  console.log('Seeding settings database if empty...');
  
  // Seed Default System Settings
  const settingsCount = await get('SELECT COUNT(*) as count FROM system_settings');
  if (parseInt(settingsCount.count, 10) === 0) {
    await setSetting('friend_discount_enabled', 'true');
    await setSetting('friend_discount_percent', '10');
    await setSetting('commission_enabled', 'true');
    await setSetting('commission_amount', '20.00');
    console.log('Default system settings seeded.');
  }

  // Seed mock batches and users from seed/seed_data.json or seed_data_test.json
  try {
    const seedFile = process.env.NODE_ENV === 'test' ? 'seed_data_test.json' : 'seed_data.json';
    const seedPath = path.join(__dirname, 'seed', seedFile);
    if (fs.existsSync(seedPath)) {
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

      // Seed Batches
      const batchCount = await get('SELECT COUNT(*) as count FROM batches');
      if (parseInt(batchCount.count, 10) === 0) {
        for (const b of seedData.batches) {
          await run(
            'INSERT INTO batches (name, code, masterclass_date, registration_date, gap_date, bridge_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [b.name, b.code, b.masterclass_date, b.registration_date, b.gap_date, b.bridge_date, 1]
          );
        }
        console.log('Mock batches seeded successfully.');
      }

      // Seed Users
      const userCount = await get('SELECT COUNT(*) as count FROM users');
      if (parseInt(userCount.count, 10) === 0) {
        for (const u of seedData.users) {
          const dbBatch = await get('SELECT id FROM batches WHERE code = ?', [u.batch]);
          const batchId = dbBatch ? dbBatch.id : null;
          
          const res = await run(
            'INSERT INTO users (name, email, phone, batch_id, current_stage, is_active, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [u.name, u.email, u.phone, batchId, u.stage, 1, u.role || 'USER']
          );
          
          const newUserId = res.id;
          if (newUserId) {
            // Also insert blank progress record
            await run(
              'INSERT INTO user_progress (user_id, masterclass_attended, registration_completed, gap_completed, payment_1_completed, bridge_completed, payment_2_completed, certified, partner_activated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [newUserId, 0, 0, 0, 0, 0, 0, 0, 0]
            );
          }
        }
        console.log('Mock users and progress records seeded successfully.');
      }
    } else {
      console.warn('Seeding skipped: seed_data.json not found at', seedPath);
    }
  } catch (err) {
    console.error('Error seeding database:', err.message);
  }

  const count = await get('SELECT COUNT(*) as count FROM event_logs');
  if (parseInt(count.count, 10) === 0) {
    await logEvent('DatabaseSeeded', {
      batches: 3,
      users: 3
    });
  }
}

// Sync user stage and progress tables
async function syncUserStageAndProgress(userId, forceSyncFromStage = false) {
  try {
    // 1. Fetch user details
    const user = await get('SELECT id, name, email, current_stage, role FROM users WHERE id = ?', [userId]);
    if (!user) return null;

    // 2. Fetch or create user progress record
    let progress = await get('SELECT * FROM user_progress WHERE user_id = ?', [userId]);
    if (!progress) {
      await run('INSERT INTO user_progress (user_id) VALUES (?)', [userId]);
      progress = await get('SELECT * FROM user_progress WHERE user_id = ?', [userId]);
    }

    const stages = [
      'INVITED',
      'MASTERCLASS',
      'REGISTRATION',
      'GAP',
      'PAYMENT_1',
      'BRIDGE',
      'PAYMENT_2',
      'CERTIFICATION',
      'PARTNER'
    ];

    const isTrue = (val) => val === true || val === 1 || val === 'true';

    // 3. Determine stage implied by progress checkboxes
    let progressStage = 'INVITED';
    if (isTrue(progress.certified) || isTrue(progress.partner_activated)) {
      progressStage = 'PARTNER';
    } else if (isTrue(progress.payment_2_completed)) {
      progressStage = 'CERTIFICATION';
    } else if (isTrue(progress.bridge_completed)) {
      progressStage = 'PAYMENT_2';
    } else if (isTrue(progress.payment_1_completed)) {
      progressStage = 'BRIDGE';
    } else if (isTrue(progress.gap_completed)) {
      progressStage = 'PAYMENT_1';
    } else if (isTrue(progress.registration_completed)) {
      progressStage = 'GAP';
    } else if (isTrue(progress.masterclass_attended)) {
      progressStage = 'REGISTRATION';
    }

    const currentStage = user.current_stage ? user.current_stage.toUpperCase() : 'INVITED';
    const currentIdx = stages.indexOf(currentStage) !== -1 ? stages.indexOf(currentStage) : 0;
    const progressIdx = stages.indexOf(progressStage);

    if (forceSyncFromStage) {
      // Trust stage, update checkboxes to match
      const masterclass_attended = currentIdx >= 2;
      const registration_completed = currentIdx >= 3;
      const gap_completed = currentIdx >= 4;
      const payment_1_completed = currentIdx >= 5;
      const bridge_completed = currentIdx >= 6;
      const payment_2_completed = currentIdx >= 7;
      const certified = currentIdx >= 8;
      const partner_activated = currentIdx >= 8;

      await run(`
        UPDATE user_progress 
        SET masterclass_attended = ?, 
            registration_completed = ?, 
            gap_completed = ?, 
            payment_1_completed = ?, 
            bridge_completed = ?, 
            payment_2_completed = ?, 
            certified = ?, 
            partner_activated = ?
        WHERE user_id = ?`,
        [
          masterclass_attended,
          registration_completed,
          gap_completed,
          payment_1_completed,
          bridge_completed,
          payment_2_completed,
          certified,
          partner_activated,
          userId
        ]
      );
      console.log(`[SYNC-FORCE] Updated progress for user ${user.email} to match stage ${currentStage}`);
      return { progressUpdated: true, stage: currentStage };
    }

    if (progressIdx > currentIdx) {
      // Progress is ahead. Update stage to match progress.
      const targetStage = progressStage;
      await run('UPDATE users SET current_stage = ?, updated_at = ? WHERE id = ?', [targetStage, new Date().toISOString(), userId]);
      
      if (targetStage === 'PARTNER' && user.role !== 'PARTNER') {
        await run("UPDATE users SET role = 'PARTNER' WHERE id = ?", [userId]);
      }
      
      console.log(`[SYNC-AUTO] Advanced user ${user.email} stage from ${currentStage} to ${targetStage} based on progress`);
      return { stageUpdated: true, newStage: targetStage };
    } else if (currentIdx > progressIdx) {
      // Stage is ahead of progress. Update checkboxes to match stage.
      const masterclass_attended = currentIdx >= 2;
      const registration_completed = currentIdx >= 3;
      const gap_completed = currentIdx >= 4;
      const payment_1_completed = currentIdx >= 5;
      const bridge_completed = currentIdx >= 6;
      const payment_2_completed = currentIdx >= 7;
      const certified = currentIdx >= 8;
      const partner_activated = currentIdx >= 8;

      await run(`
        UPDATE user_progress 
        SET masterclass_attended = ?, 
            registration_completed = ?, 
            gap_completed = ?, 
            payment_1_completed = ?, 
            bridge_completed = ?, 
            payment_2_completed = ?, 
            certified = ?, 
            partner_activated = ?
        WHERE user_id = ?`,
        [
          masterclass_attended,
          registration_completed,
          gap_completed,
          payment_1_completed,
          bridge_completed,
          payment_2_completed,
          certified,
          partner_activated,
          userId
        ]
      );
      console.log(`[SYNC-AUTO] Updated progress for user ${user.email} to match stage ${currentStage}`);
      return { progressUpdated: true, stage: currentStage };
    }
  } catch (err) {
    console.error(`[SYNC ERROR] Failed to sync stage/progress for user ID ${userId}:`, err.message);
  }
  return null;
}

// Sync all users stage and progress records
async function syncAllUsersStageAndProgress() {
  try {
    const users = await all('SELECT id FROM users');
    for (const u of users) {
      await syncUserStageAndProgress(u.id);
    }
    console.log('[SYNC] Successfully completed synchronization for all users.');
  } catch (err) {
    console.error('[SYNC ALL ERROR] Failed to sync all users:', err.message);
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  logEvent,
  logAudit,
  initDatabase,
  isPostgres,
  getSetting,
  setSetting,
  syncUserStageAndProgress,
  syncAllUsersStageAndProgress
};
