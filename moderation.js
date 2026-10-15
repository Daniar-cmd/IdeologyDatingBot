const path = require('path')
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '.env') })

const TelegramApi = require('node-telegram-bot-api')

const ModerationConsole = require('./cli/ModerationConsole')
const ModerationActionsService = require('./services/ModerationActionsService')
const ModeratorService = require('./services/ModeratorService')
const ReportService = require('./services/ReportService')
const SupportTicketService = require('./services/SupportTicketService')
const DevHistoryService = require('./services/DevHistoryService')
const BroadcastService = require('./services/BroadcastService')
const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
const ModerationActionRepository = require('./repositories/ModerationActionRepository')
const ModeratorRepository = require('./repositories/ModeratorRepository')
const ReportRepository = require('./repositories/ReportRepository')
const SupportTicketRepository = require('./repositories/SupportTicketRepository')
const BroadcastRepository = require('./repositories/BroadcastRepository')
const { parseModeratorIDs } = require('./config/moderators')
const { resolveRuntime } = require('./config/runtime')
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

// Аккаунты администраторов: MODERATOR_ACCOUNTS (несколько) либо
// MODERATOR_NAME + MODERATOR_PIN (один). Вход всегда по имени и паролю.
function resolveAccounts() {
    const many = parseAccounts(process.env.MODERATOR_ACCOUNTS)

    if (many.length > 0) {
        return many
    }

    const single = parseSingleAccount()

    return single ? [single] : []
}

// Отправка уведомлений пользователям из консоли. Поллинг отключён,
// чтобы не конфликтовать с основным процессом бота (ошибка 409 Conflict).
function createNotifier() {
    // Клиент использует тот же токен, что и запущенный бот: в тестовом режиме
    // это TEST_BOT_TOKEN, иначе боевой BOT_TOKEN.
    const { botToken } = resolveRuntime()

    if (!botToken) {
        return null
    }

    try {
        return new TelegramApi(botToken, { polling: false })
    } catch (error) {
        console.error('⚠️  Не удалось создать Telegram-клиент для уведомлений:', error.message)
        return null
    }
}

// Короткая метка контура в шапке консоли, чтобы не спутать тест с боем.
function runtimeLabel() {
    const { mode, schema } = resolveRuntime()

    return `${mode === 'test' ? 'ТЕСТОВЫЙ' : 'БОЕВОЙ'}${schema ? ` / схема ${schema}` : ''}`
}

async function main() {
    // Имя администратора передаётся аргументом (npm run admin daniiar)
    // или вводится интерактивно, если аргумент не пробросился.
    const name = (process.argv[2] || '').trim()

    const accounts = resolveAccounts()

    // Диагностика без входа и без БД: npm run admin -- --list
    if (name === '--list' || name === '--moderators' || name === 'list') {
        console.log('Контур:', runtimeLabel())
        console.log('MODERATOR_ACCOUNTS:', process.env.MODERATOR_ACCOUNTS ? 'задана' : 'НЕ ЗАДАНА')
        console.log('Настроено аккаунтов администраторов:', accounts.length)

        for (const account of accounts) {
            const id = account.telegramID ?? '—'
            console.log(`  - ${account.name} (telegramID: ${id})`)
        }

        if (accounts.length === 0) {
            console.log('  Задай MODERATOR_ACCOUNTS=имя:пароль:telegramID')
        }

        return
    }

    if (accounts.length === 0) {
        console.error('❌ В .env не настроены аккаунты администраторов (MODERATOR_ACCOUNTS).')
        process.exit(1)
    }

    await initDatabase()

    console.log('Контур:', runtimeLabel())

    const userRepository = new UserRepository(db, User)
    const moderationActionRepository = new ModerationActionRepository(db)
    const moderatorRepository = new ModeratorRepository(db)
    const reportRepository = new ReportRepository(db)
    const reportService = new ReportService(reportRepository)

    const supportTicketRepository = new SupportTicketRepository(db)
    const supportTicketService = new SupportTicketService(supportTicketRepository)

    // Рассылки («Радио»): консоль создаёт задание и просит модератора написать пост.
    const broadcastRepository = new BroadcastRepository(db)
    const broadcastService = new BroadcastService({ broadcastRepository })

    const devHistoryService = new DevHistoryService()

    const moderatorService = new ModeratorService(moderatorRepository)

    // Один и тот же Telegram-клиент (без поллинга) используется для уведомлений
    // пользователям и для принудительной отправки жалоб модераторам из консоли.
    const notifier = createNotifier()

    const moderationActions = new ModerationActionsService({
        userRepository,
        bot: notifier,
        moderationActionRepository
    })

    const cli = new ModerationConsole({
        input: process.stdin,
        output: process.stdout,
        accounts,
        userRepository,
        moderationActions,
        reportService,
        notifier,
        moderatorChatIDs: parseModeratorIDs(process.env.MODERATORSID),
        moderationActionRepository,
        moderatorService,
        supportTicketService,
        devHistoryService,
        broadcastService,
        broadcastRepository
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
