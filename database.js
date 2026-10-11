const { Pool } = require('pg')

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000
})

db.on('error', error => {
    console.error('Ошибка пула PostgreSQL:', error.message)
})

async function initDatabase() {

    try {
        // Проверяем, что база данных доступна
        await db.query('SELECT 1')

        // Создаём таблицу, если её ещё нет
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

    } catch (error) {
        console.error('Ошибка инициализации PostgreSQL:')
        console.error(error.message)
        throw error
    }
}

module.exports = { db, initDatabase }