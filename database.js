const { Pool } = require('pg')
const { resolveRuntime } = require('./config/runtime')

// Режим окружения (боевой/тестовый) и изоляция данных описаны в config/runtime.js.
const runtime = resolveRuntime()

// Имя схемы подставляется в SQL как идентификатор (параметризовать нельзя),
// поэтому допускаем только безопасный набор символов.
function safeSchema(name) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`Недопустимое имя схемы БД: ${name}`)
    }

    return name
}

const poolConfig = {
    connectionString: runtime.databaseUrl,
    connectionTimeoutMillis: 5000
}

if (runtime.schema) {
    // Тестовый контур живёт в отдельной схеме той же БД: все
    // неквалифицированные таблицы создаются и читаются только там,
    // поэтому боевые данные (схема public) не задеваются.
    poolConfig.options = `-c search_path=${safeSchema(runtime.schema)}`
}

const db = new Pool(poolConfig)

db.on('error', error => {
    console.error('Ошибка пула PostgreSQL:', error.message)
})

async function initDatabase() {

    if (!runtime.databaseUrl) {
        throw new Error(runtime.mode === 'test'
            ? 'В .env не задан TEST_DATABASE_URL или DATABASE_URL'
            : 'В .env не задан DATABASE_URL')
    }

    try {
        // Проверяем, что база данных доступна
        await db.query('SELECT 1')

        // В тестовом режиме создаём изолированную схему, если её ещё нет.
        if (runtime.schema) {
            await db.query(`CREATE SCHEMA IF NOT EXISTS ${safeSchema(runtime.schema)}`)
        }

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

        // Обращения пользователей в поддержку (тикеты из команды /help)
        await db.query(`
            CREATE TABLE IF NOT EXISTS support_tickets (
                id SERIAL PRIMARY KEY,
                user_chat_id TEXT NOT NULL,
                username TEXT,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'new',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                read_at TIMESTAMPTZ,
                read_by TEXT,
                replied_at TIMESTAMPTZ,
                replied_by TEXT,
                reply_text TEXT
            )
        `)

        // Добавляем колонки для уже существующих таблиц (без разрушения данных)
        await db.query(`
            ALTER TABLE support_tickets
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
            ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS read_by TEXT,
            ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS replied_by TEXT,
            ADD COLUMN IF NOT EXISTS reply_text TEXT
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

        // Приглашения в модераторы (одно активное приглашение на пользователя).
        // notified — бот уже отправил приглашённому сообщение с кнопками.
        await db.query(`
            CREATE TABLE IF NOT EXISTS moderator_invites (
                chat_id TEXT PRIMARY KEY,
                invite_code TEXT NOT NULL,
                invited_by TEXT,
                status TEXT DEFAULT 'pending',
                notified BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ
            )
        `)

        // Дозаполняем колонку в уже существующих базах.
        await db.query(`
            ALTER TABLE moderator_invites
            ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT FALSE
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

        // Рефералы: кто кого пригласил по ссылке /start ref_<id>.
        // referred_chat_id — первичный ключ, поэтому у одного пользователя
        // может быть только один пригласивший (первый заход по ссылке).
        // В счётчик идут только анкеты, доведённые до конца (completed = TRUE).
        await db.query(`
            CREATE TABLE IF NOT EXISTS referrals (
                referred_chat_id TEXT PRIMARY KEY,
                referrer_chat_id TEXT NOT NULL,
                completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )
        `)

        await db.query(`
            CREATE INDEX IF NOT EXISTS referrals_referrer_idx
            ON referrals (referrer_chat_id)
        `)

        // Рассылки («Радио»). Консоль создаёт запись со статусом pending и
        // фильтром аудитории; назначенный модератор пишет пост (текст и/или
        // фото) в Telegram, подтверждает ключом 2 — тогда бот рассылает пост
        // получателям и записывает сюда итоги (status = sent).
        await db.query(`
            CREATE TABLE IF NOT EXISTS broadcasts (
                id SERIAL PRIMARY KEY,
                author TEXT,
                moderator_chat_id TEXT,
                moderator_username TEXT,
                gender TEXT,
                cities TEXT,
                is_global BOOLEAN DEFAULT FALSE,
                age_from INTEGER,
                age_to INTEGER,
                status TEXT DEFAULT 'pending',
                notified BOOLEAN NOT NULL DEFAULT FALSE,
                content_text TEXT,
                photo_file_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                sent_at TIMESTAMPTZ,
                total INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0
            )
        `)

        // Дозаполняем колонку в уже существующих базах. notified — бот уже
        // отправил назначенному модератору запрос «Написать».
        await db.query(`
            ALTER TABLE broadcasts
            ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT FALSE
        `)

    } catch (error) {
        console.error('Ошибка инициализации PostgreSQL:')
        console.error(error.message)
        throw error
    }
}

module.exports = { db, initDatabase, runtime }