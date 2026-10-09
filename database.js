const Database = require('better-sqlite3')
const db = new Database('dating.db')

db.pragma('journal_mode = WAL')

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        chat_id TEXT PRIMARY KEY,
        username TEXT,
        registered INTEGER DEFAULT 0,
        name TEXT,
        gender TEXT,
        age INTEGER,
        description TEXT DEFAULT '',
        city TEXT,
        photos TEXT DEFAULT '[]',
        likes TEXT DEFAULT '[]',
        liked_by TEXT DEFAULT '[]',
        viewed TEXT DEFAULT '[]',
        state TEXT
    )
`)

module.exports = db