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
                looking_for TEXT,
                age INTEGER,
                description TEXT DEFAULT '',
                city TEXT,
                is_global BOOLEAN DEFAULT FALSE,
                hidden BOOLEAN DEFAULT FALSE,
                banned BOOLEAN DEFAULT FALSE,
                banned_until TIMESTAMPTZ,
                banned_at TIMESTAMPTZ,
                banned_by TEXT,
                ban_reason TEXT,
                warnings INTEGER DEFAULT 0,
                photos JSONB DEFAULT '[]'::jsonb,
                likes JSONB DEFAULT '[]'::jsonb,
                liked_by JSONB DEFAULT '[]'::jsonb,
                viewed JSONB DEFAULT '[]'::jsonb,
                matches JSONB DEFAULT '[]'::jsonb,
                state TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `)

        // Добавляем колонки для уже существующих таблиц (без разрушения данных)
        await db.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS looking_for TEXT,
            ADD COLUMN IF NOT EXISTS matches JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS banned_by TEXT,
            ADD COLUMN IF NOT EXISTS ban_reason TEXT,
            ADD COLUMN IF NOT EXISTS warnings INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
        `)

        // Жалобы пользователей на анкеты
        await db.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_chat_id TEXT NOT NULL,
                reported_chat_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'new',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                processed_at TIMESTAMPTZ,
                resolved_by TEXT,
                resolved_action TEXT,
                resolved_reason TEXT
            )
        `)

        // Добавляем колонки для уже существующих таблиц (без разрушения данных)
        await db.query(`
            ALTER TABLE reports
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
            ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS resolved_by TEXT,
            ADD COLUMN IF NOT EXISTS resolved_action TEXT,
            ADD COLUMN IF NOT EXISTS resolved_reason TEXT
        `)

        // Заморозка модераторов за неверные admin-ключи
        await db.query(`
            CREATE TABLE IF NOT EXISTS moderator_freezes (
                chat_id TEXT PRIMARY KEY,
                frozen_until TIMESTAMPTZ NOT NULL
            )
        `)

        // Модераторы: личные admin-ключи и статус (активен / снят).
        // Встроенные модераторы из MODERATORSID могут отсутствовать в таблице —
        // тогда используются общие ключи ADMIN_PIN_KEY1/2 из .env.
        await db.query(`
            CREATE TABLE IF NOT EXISTS moderators (
                chat_id TEXT PRIMARY KEY,
                username TEXT,
                name TEXT,
                pin1 TEXT,
                pin2 TEXT,
                added_by TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                removed_at TIMESTAMPTZ
            )
        `)

        // Приглашения в модераторы (одно активное приглашение на пользователя)
        await db.query(`
            CREATE TABLE IF NOT EXISTS moderator_invites (
                chat_id TEXT PRIMARY KEY,
                invite_code TEXT NOT NULL,
                invited_by TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ
            )
        `)

        // Логи действий модерации (консоль + Telegram)
        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_actions (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                moderator_name TEXT,
                moderator_telegram_id TEXT,
                target_chat_id TEXT NOT NULL,
                target_username TEXT,
                duration_ms BIGINT,
                reason TEXT,
                note TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `)

        // Сообщения, прикреплённые к лайку (разовые, переписка внутри бота не ведётся)
        await db.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                from_chat_id TEXT NOT NULL,
                to_chat_id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `)

        await db.query(`
            CREATE INDEX IF NOT EXISTS messages_from_to_idx
            ON messages (from_chat_id, to_chat_id, created_at)
        `)

    } catch (error) {
        console.error('Ошибка инициализации PostgreSQL:')
        console.error(error.message)
        throw error
    }
}

module.exports = { db, initDatabase }