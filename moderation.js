const path = require('path')
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '.env') })

const TelegramApi = require('node-telegram-bot-api')

const ModerationConsole = require('./cli/ModerationConsole')
const ModerationActionsService = require('./services/ModerationActionsService')
const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
const ModerationActionRepository = require('./repositories/ModerationActionRepository')
const { db, initDatabase } = require('./database')

// Формат: MODERATOR_ACCOUNTS=имя:пароль:telegramID, имя2:пароль2:telegramID
// Пароль может содержать ':' — границы берутся по первому и последнему разделителю.
function parseAccounts(envValue) {
    if (!envValue) {
        return []
    }

    return String(envValue)
        .replace(/[\[\]"' ]/g, '')
        .split(',')
        .filter(Boolean)
        .map(entry => {
            const segments = entry.split(':')

            if (segments.length < 3) {
                return null
            }

            const name = segments[0]
            const password = segments.slice(1, -1).join(':')
            const telegramID = Number(segments[segments.length - 1])

            if (!name || !password || !Number.isInteger(telegramID) || telegramID <= 0) {
                return null
            }

            return { name, password, telegramID }
        })
        .filter(Boolean)
}

// Одиночный аккаунт через отдельные переменные:
// MODERATOR_NAME, MODERATOR_PIN и необязательный MODERATOR_TELEGRAM_ID.
function parseSingleAccount() {
    const name = (process.env.MODERATOR_NAME || '').trim()
    const password = String(process.env.MODERATOR_PIN || '')

    if (!name || !password) {
        return null
    }

    const idRaw = String(process.env.MODERATOR_TELEGRAM_ID || process.env.MODERATOR_ID || '').trim()
    const idNumber = Number(idRaw)
    const telegramID = idRaw && Number.isInteger(idNumber) && idNumber > 0 ? idNumber : null

    return { name, password, telegramID }
}

// Источники настроек в порядке приоритета:
// 1) MODERATOR_ACCOUNTS (несколько модераторов) — вход по имени и паролю;
// 2) MODERATOR_NAME + MODERATOR_PIN (один модератор) — вход без запроса пароля.
function resolveAccounts() {
    const many = parseAccounts(process.env.MODERATOR_ACCOUNTS)

    if (many.length > 0) {
        return { accounts: many, autoLogin: false }
    }

    const single = parseSingleAccount()

    if (single) {
        return { accounts: [single], autoLogin: true }
    }

    return { accounts: [], autoLogin: false }
}

// Отправка уведомлений пользователям из консоли. Поллинг отключён,
// чтобы не конфликтовать с основным процессом бота (ошибка 409 Conflict).
function createNotifier() {
    if (!process.env.BOT_TOKEN) {
        return null
    }

    try {
        return new TelegramApi(process.env.BOT_TOKEN, { polling: false })
    } catch (error) {
        console.error('⚠️  Не удалось создать Telegram-клиент для уведомлений:', error.message)
        return null
    }
}

async function main() {
    // Имя модератора можно передать аргументом (npm run moderation daniiar)
    // или ввести интерактивно, если аргумент не пробросился.
    const name = (process.argv[2] || '').trim()

    const { accounts, autoLogin } = resolveAccounts()

    // Диагностика без входа и без БД: npm run moderation --list
    if (name === '--list' || name === '--moderators' || name === 'list') {
        console.log('MODERATOR_ACCOUNTS:', process.env.MODERATOR_ACCOUNTS ? 'задана' : 'НЕ ЗАДАНА')
        console.log('MODERATOR_NAME:', process.env.MODERATOR_NAME ? 'задана' : 'НЕ ЗАДАНА')
        console.log('MODERATOR_PIN:', process.env.MODERATOR_PIN ? 'задана' : 'НЕ ЗАДАНА')
        console.log('Режим:', autoLogin ? 'один модератор (вход без пароля)' : 'по имени и паролю')
        console.log('Настроено аккаунтов модераторов:', accounts.length)

        for (const account of accounts) {
            const id = account.telegramID ?? '—'
            console.log(`  - ${account.name} (telegramID: ${id})`)
        }

        if (accounts.length === 0) {
            console.log('  Задай MODERATOR_ACCOUNTS=имя:пароль:telegramID либо MODERATOR_NAME + MODERATOR_PIN.')
        }

        return
    }

    if (accounts.length === 0) {
        console.error('❌ Не настроены модераторы.')
        console.error('   Задай MODERATOR_ACCOUNTS=имя:пароль:telegramID')
        console.error('   или MODERATOR_NAME + MODERATOR_PIN (один модератор).')
        process.exit(1)
    }

    await initDatabase()

    const userRepository = new UserRepository(db, User)
    const moderationActionRepository = new ModerationActionRepository(db)
    const moderationActions = new ModerationActionsService({
        userRepository,
        bot: createNotifier(),
        moderationActionRepository
    })

    const cli = new ModerationConsole({
        input: process.stdin,
        output: process.stdout,
        accounts,
        autoLogin,
        userRepository,
        moderationActions
    })

    let ok = false

    try {
        ok = await cli.start(name)
    } finally {
        cli.close()
        await db.end().catch(() => {})
    }

    process.exitCode = ok ? 0 : 1
}

if (require.main === module) {
    main().catch(error => {
        console.error('Ошибка консоли модерации:', error)
        process.exit(1)
    })
}
