require('dotenv').config({ quiet: true })

const ModerationConsole = require('./cli/ModerationConsole')
const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
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

async function main() {
    const name = (process.argv[2] || '').trim()

    if (!name) {
        console.error('❌ Укажите имя модератора, например:\n   npm run moderation daniiar')
        process.exit(1)
    }

    const accounts = parseAccounts(process.env.MODERATOR_ACCOUNTS)

    if (accounts.length === 0) {
        console.error('❌ В .env не настроены аккаунты модераторов (MODERATOR_ACCOUNTS).')
        process.exit(1)
    }

    const cli = new ModerationConsole({
        input: process.stdin,
        output: process.stdout,
        accounts
    })

    await initDatabase()
    const userRepository = new UserRepository(db, User)

    const cliWithRepo = new ModerationConsole({
        input: process.stdin,
        output: process.stdout,
        accounts,
        userRepository
    })

    const ok = await cliWithRepo.start(name)
    await db.end().catch(() => {})
    process.exit(ok ? 0 : 1)
}

if (require.main === module) {
    main().catch(error => {
        console.error('Ошибка консоли модерации:', error)
        process.exit(1)
    })
}