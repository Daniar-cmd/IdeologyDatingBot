const { Pool } = require('pg')

const db = new Pool({
    connectionString: process.env.DATABASE_URL
})

async function initDatabase() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            chat_id TEXT PRIMARY KEY,
            username TEXT,
            registered INTEGER DEFAULT 0,
            name TEXT,
            gender TEXT,
            age INTEGER,
            description TEXT DEFAULT '',
            city TEXT,
            photos JSONB DEFAULT '[]'::jsonb,
            likes JSONB DEFAULT '[]'::jsonb,
            liked_by JSONB DEFAULT '[]'::jsonb,
            viewed JSONB DEFAULT '[]'::jsonb,
            state TEXT
        )
    `)

    console.log('PostgreSQL: таблица users готова')
}

module.exports = { db, initDatabase }