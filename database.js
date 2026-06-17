const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const isPostgres = !!process.env.POSTGRES_URL;

let db;
let pool;

if (isPostgres) {
  console.log('Connecting to PostgreSQL database...');
  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
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
        if (!pgSql.toUpperCase().includes('RETURNING')) {
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

// Initialize database schema
async function initDatabase() {
  if (isPostgres) {
    // Event Logs Table
    await run(`CREATE TABLE IF NOT EXISTS event_logs (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(255) NOT NULL,
      payload TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Users Table (Sign up accounts)
    await run(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      purchased_courses TEXT DEFAULT '[]',
      referred_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Affiliates Table (Referral profiles)
    await run(`CREATE TABLE IF NOT EXISTS affiliates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      affiliate_code VARCHAR(255) UNIQUE NOT NULL,
      coupon_code VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Clicks Table
    await run(`CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      ip_address VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Signups Table
    await run(`CREATE TABLE IF NOT EXISTS signups (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      friend_email VARCHAR(255) NOT NULL,
      commission_amount REAL DEFAULT 20.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // System Settings Table
    await run(`CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(255) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    )`);
  } else {
    // Enable foreign keys in SQLite
    await run('PRAGMA foreign_keys = ON');

    // Event Logs Table
    await run(`CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Users Table
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      purchased_courses TEXT DEFAULT '[]',
      referred_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Affiliates Table
    await run(`CREATE TABLE IF NOT EXISTS affiliates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      affiliate_code TEXT UNIQUE NOT NULL,
      coupon_code TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Clicks Table
    await run(`CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER NOT NULL,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
    )`);

    // Signups Table
    await run(`CREATE TABLE IF NOT EXISTS signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER NOT NULL,
      friend_email TEXT NOT NULL,
      commission_amount REAL DEFAULT 20.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE
    )`);

    // System Settings Table
    await run(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  }

  // Seed Data if Database is empty
  await seedDatabase();
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
  if (settingsCount.count === 0) {
    await setSetting('friend_discount_enabled', 'true');
    await setSetting('friend_discount_percent', '10');
    await setSetting('commission_enabled', 'true');
    await setSetting('commission_amount', '20.00');
    console.log('Default system settings seeded.');
  }

  const count = await get('SELECT COUNT(*) as count FROM event_logs');
  if (count.count === 0) {
    await logEvent('DatabaseSeeded', {
      affiliates: 0,
      clicks: 0,
      signups: 0
    });
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  logEvent,
  initDatabase,
  isPostgres,
  getSetting,
  setSetting
};
