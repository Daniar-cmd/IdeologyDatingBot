// Режим окружения бота и панели модерации.
//
// prod — боевой контур: BOT_TOKEN и DATABASE_URL (обычно схема public).
// test — тестовый контур: TEST_BOT_TOKEN и изолированные данные, чтобы
//        тестовый бот не видел и не портил боевые анкеты, жалобы, рассылки.
//
// Изоляция тестовых данных: по умолчанию это отдельная схема TEST_DB_SCHEMA
// (ideology_test) в той же БД. Если для теста выделена отдельная база, задай
// TEST_DATABASE_URL — тогда схема не нужна.
//
// Режим включается переменной BOT_ENV=test; при любом другом значении — prod.

const DEFAULT_TEST_SCHEMA = 'ideology_test'

function resolveRuntime(env = process.env) {
    const requested = String(env.BOT_ENV || '').trim().toLowerCase()
    const mode = requested === 'test' ? 'test' : 'prod'

    if (mode === 'test') {
        const hasOwnDatabase = Boolean((env.TEST_DATABASE_URL || '').trim())
        const schema = hasOwnDatabase
            ? null
            : ((env.TEST_DB_SCHEMA || '').trim() || DEFAULT_TEST_SCHEMA)

        // Схема public — это боевые данные: тестовый контур не должен туда писать.
        if (schema && schema.toLowerCase() === 'public') {
            throw new Error(
                'Тестовый режим не может использовать схему public (боевые данные). ' +
                'Задай TEST_DB_SCHEMA или отдельную TEST_DATABASE_URL.'
            )
        }

        return {
            mode,
            botToken: (env.TEST_BOT_TOKEN || '').trim() || null,
            databaseUrl: (env.TEST_DATABASE_URL || env.DATABASE_URL || '').trim() || null,
            schema
        }
    }

    return {
        mode,
        botToken: (env.BOT_TOKEN || '').trim() || null,
        databaseUrl: (env.DATABASE_URL || '').trim() || null,
        schema: null
    }
}

module.exports = { resolveRuntime, DEFAULT_TEST_SCHEMA }
