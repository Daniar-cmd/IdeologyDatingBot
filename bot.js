const TelegramApi = require('node-telegram-bot-api')
const { db, initDatabase } = require('./database')

const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
const ReportRepository = require('./repositories/ReportRepository')
const ModeratorRepository = require('./repositories/ModeratorRepository')

const RegistrationService = require('./services/RegistrationService')
const LikeService = require('./services/LikeService')
const MatchingService = require('./services/MatchingService')
const ProfileService = require('./services/ProfileService')
const ReportService = require('./services/ReportService')
const ModeratorService = require('./services/ModeratorService')
const CityService = require('./services/CityService')
const ContentFilter = require('./services/ContentFilter')

const MessageHandler = require('./handlers/MessageHandler')

// Список чатов-модераторов: MODERATORSID=[1001, 1002] или '1001,1002'
function parseModeratorIDs(envValue) {
    if (!envValue) {
        return []
    }

    return String(envValue)
        .replace(/[\[\]"']/g, '')
        .split(',')
        .map(part => Number(part.trim()))
        .filter(id => Number.isInteger(id) && id > 0)
}

class Bot {
    constructor() {
        if (!process.env.BOT_TOKEN) {
            throw new Error('Не найден BOT_TOKEN в файле .env')
        }

        this.bot = new TelegramApi(process.env.BOT_TOKEN, {
            polling: false
        })

        this.users = {}

        this.userRepository = new UserRepository(db, User)
        this.reportRepository = new ReportRepository(db)
        this.moderatorRepository = new ModeratorRepository(db)

        this.likeService = new LikeService(this.users)
        this.cityService = new CityService()
        this.contentFilter = new ContentFilter()
        this.matchingService = new MatchingService(this.users, this.cityService)
        this.profileService = new ProfileService(this.users)

        this.registrationService = new RegistrationService(
            this.users,
            User,
            process.env.INVITE_CODE || 'YABLOKO',
            this.cityService,
            this.contentFilter
        )

        this.reportService = new ReportService(this.reportRepository)
        this.moderatorService = new ModeratorService(this.moderatorRepository)

        this.moderatorChatIDs = parseModeratorIDs(process.env.MODERATORSID || process.env.REPORT_CHAT_IDS)

        this.messageHandler = new MessageHandler(
            this.bot,
            this.users,
            this.registrationService,
            this.profileService,
            this.matchingService,
            this.likeService,
            this.cityService,
            this.reportService,
            this.moderatorChatIDs,
            this.moderatorService,
            null,
            this.userRepository
        )

        this.saveInterval = null
        this.moderationInterval = null
    }

    async loadUsers() {
        const loadedUsers = await this.userRepository.findAll()

        for (const user of loadedUsers) {
            // Новая очередь регистрации: возраст → город → описание → фото.
            // Если пользователь «завис» на старом шаге описания без города
            // (раньше город шёл после описания), отправляем его на шаг города.
            if (user.waitingForDescription && !user.city && !user.isGlobal) {
                user.waitingForDescription = false
                user.waitingForCity = true
            }

            this.users[user.chatID] = user
        }

        console.log(`Загружено анкет: ${loadedUsers.length}`)
    }

    async saveAllUsers() {
        await this.userRepository.saveAll(this.users)
    }

    // Подтягивает поля модерации из БД в память работающего бота, чтобы изменения
    // из консольной панели (баны/варны) применялись без перезапуска.
    // Заодно снимает истёкшие временные баны.
    async syncModerationFromDb() {
        if (typeof this.userRepository.getModerationStates !== 'function') {
            return
        }

        const states = await this.userRepository.getModerationStates()
        const now = Date.now()

        for (const state of states) {
            const user = this.users[state.chatID]

            if (!user) {
                continue
            }

            const expired = state.banned &&
                state.bannedUntil &&
                state.bannedUntil.getTime() <= now

            if (expired) {
                user.banned = false
                user.bannedUntil = null
                user.warnings = state.warnings

                await this.userRepository.setModerationState(state.chatID, {
                    banned: false,
                    warnings: state.warnings,
                    bannedUntil: null
                }).catch(error => {
                    console.error('Ошибка снятия истёкшего бана:', error.message)
                })

                console.log(`[Модерация] срок бана истёк: ${state.chatID}`)
                continue
            }

            user.banned = state.banned
            user.warnings = state.warnings
            user.bannedUntil = state.bannedUntil
        }
    }

    startAutoSave() {
        this.saveInterval = setInterval(() => {
            this.saveAllUsers().catch(error => {
                console.error('Ошибка сохранения анкет:', error)
            })
        }, 5000)

        // Модерацию синхронизируем чаще (2с), чтобы баны/варны из консоли
        // применялись к работающему боту почти сразу.
        this.moderationInterval = setInterval(() => {
            this.syncModerationFromDb().catch(error => {
                console.error('Ошибка синхронизации модерации:', error)
            })
        }, 2000)
    }

    registerCommands() {
        this.bot.setMyCommands([
            {
                command: 'start',
                description: 'Запустить бота, начать все заново'
            },
            {
                command: 'myprofile',
                description: 'Посмотреть свою анкету'
            },
            {
                command: 'lenta',
                description: 'Смотреть анкеты пользователей'
            },
            {
                command: 'report',
                description: 'Пожаловаться на анкету'
            }
        ])
    }

    async start() {
        try {

            await initDatabase()

            if (this.moderatorChatIDs.length === 0) {
                console.warn('⚠️  MODERATORSID не задан — уведомления о жалобах модераторам отправляться не будут.')
            } else {
                console.log(`Модерация жалоб: уведомления включены (получателей: ${this.moderatorChatIDs.length})`)
            }

            await this.loadUsers()

            await this.saveAllUsers()

            this.registerCommands()
            this.messageHandler.register()

            this.startAutoSave()
            await this.bot.startPolling()

            console.log('Бот запущен!')

        } catch (error) {
            console.error('❌ Ошибка запуска бота:', error)
            process.exitCode = 1
            throw error
        }
    }
}

module.exports = Bot
module.exports.parseModeratorIDs = parseModeratorIDs