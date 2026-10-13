const TelegramApi = require('node-telegram-bot-api')
const { db, initDatabase } = require('./database')

const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
const ReportRepository = require('./repositories/ReportRepository')
const ModeratorRepository = require('./repositories/ModeratorRepository')
const MessageRepository = require('./repositories/MessageRepository')
const SupportTicketRepository = require('./repositories/SupportTicketRepository')

const RegistrationService = require('./services/RegistrationService')
const LikeService = require('./services/LikeService')
const MatchingService = require('./services/MatchingService')
const ProfileService = require('./services/ProfileService')
const ReportService = require('./services/ReportService')
const ModeratorService = require('./services/ModeratorService')
const MessageService = require('./services/MessageService')
const CityService = require('./services/CityService')
const ContentFilter = require('./services/ContentFilter')
const SupportTicketService = require('./services/SupportTicketService')

const MessageHandler = require('./handlers/MessageHandler')
const { parseModeratorIDs } = require('./config/moderators')

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
        this.messageRepository = new MessageRepository(db)
        this.supportTicketRepository = new SupportTicketRepository(db)

        this.likeService = new LikeService(this.users)
        this.cityService = new CityService()
        this.contentFilter = new ContentFilter()
        this.matchingService = new MatchingService(this.users, this.cityService)
        this.profileService = new ProfileService(this.users)

        this.messageService = new MessageService(this.messageRepository)

        this.registrationService = new RegistrationService(
            this.users,
            User,
            this.cityService,
            this.contentFilter,
            this.messageService
        )

        this.reportService = new ReportService(this.reportRepository)
        this.moderatorService = new ModeratorService(this.moderatorRepository)
        this.supportTicketService = new SupportTicketService(this.supportTicketRepository)

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
            this.userRepository,
            this.messageService,
            this.supportTicketService
        )

        this.saveInterval = null
        this.moderationInterval = null
        this.moderatorInterval = null
        this.syncingModeration = false
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

    // Подтягивает модераторов из БД: активных добавляет к встроенным (MODERATORSID),
    // снятых убирает. Обновляет список получателей жалоб и их личные admin-ключи.
    async refreshModerators() {
        const envIDs = parseModeratorIDs(process.env.MODERATORSID || process.env.REPORT_CHAT_IDS)
        const ids = new Set(envIDs)
        const pins = {}

        let rows = []

        try {
            rows = await this.moderatorRepository.listModerators()
        } catch (error) {
            console.error('Ошибка чтения модераторов из БД:', error.message)
        }

        for (const row of rows) {
            const id = Number(row.chat_id)

            if (!Number.isInteger(id)) {
                continue
            }

            if (row.active) {
                ids.add(id)

                if (row.pin1 || row.pin2) {
                    pins[id] = { pin1: row.pin1 || null, pin2: row.pin2 || null }
                }
            } else {
                ids.delete(id)
            }
        }

        this.moderatorChatIDs = [...ids]

        if (this.messageHandler) {
            this.messageHandler.setModerators(this.moderatorChatIDs, pins)
        }
    }

    // Подтягивает поля модерации из БД в память работающего бота, чтобы изменения
    // из консольной панели (баны/варны) применялись без перезапуска.
    // Заодно снимает истёкшие временные баны и уведомляет пользователя.
    async syncModerationFromDb() {
        if (typeof this.userRepository.getModerationStates !== 'function') {
            return
        }

        // Защита от наложения запусков (setInterval 2с): иначе истёкший бан
        // может обработаться дважды и пользователь получит два уведомления.
        if (this.syncingModeration) {
            return
        }

        this.syncingModeration = true

        try {
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

                    try {
                        await this.userRepository.setModerationState(state.chatID, {
                            banned: false,
                            warnings: state.warnings,
                            bannedUntil: null
                        })

                        console.log(`[Модерация] срок бана истёк: ${state.chatID}`)
                        await this.notifyUser(state.chatID, '✅ Срок блокировки истёк — вы снова можете пользоваться ботом.')
                    } catch (error) {
                        console.error('Ошибка снятия истёкшего бана:', error.message)
                    }

                    continue
                }

                user.banned = state.banned
                user.warnings = state.warnings
                user.bannedUntil = state.bannedUntil
            }
        } finally {
            this.syncingModeration = false
        }
    }

    // Уведомление пользователя (например, об истечении срока временного бана).
    async notifyUser(chatID, text) {
        if (!this.bot || !chatID) {
            return
        }

        try {
            await this.bot.sendMessage(chatID, text)
        } catch (error) {
            console.error(`Не удалось уведомить пользователя ${chatID}:`, error.message)
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

        // Список модераторов подтягиваем из БД (приглашения/снятия из панели),
        // чтобы изменения применялись без перезапуска бота.
        this.moderatorInterval = setInterval(() => {
            this.refreshModerators().catch(error => {
                console.error('Ошибка обновления модераторов:', error)
            })
        }, 5000)
    }

    registerCommands() {
        this.bot.setMyCommands([
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
            },
            {
                command: 'help',
                description: 'Справка и поддержка'
            }
        ])
    }

    async start() {
        try {

            await initDatabase()

            await this.refreshModerators()

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