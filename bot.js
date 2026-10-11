const TelegramApi = require('node-telegram-bot-api')
const { db, initDatabase } = require('./database')

const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')

const RegistrationService = require('./services/RegistrationService')
const LikeService = require('./services/LikeService')
const MatchingService = require('./services/MatchingService')
const ProfileService = require('./services/ProfileService')

const MessageHandler = require('./handlers/MessageHandler')

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

        this.likeService = new LikeService(this.users)
        this.matchingService = new MatchingService(this.users)
        this.profileService = new ProfileService(this.users)

        this.registrationService = new RegistrationService(
            this.users,
            User,
            process.env.INVITE_CODE || 'YABLOKO'
        )

        this.messageHandler = new MessageHandler(
            this.bot,
            this.users,
            this.registrationService,
            this.profileService,
            this.matchingService,
            this.likeService
        )

        this.saveInterval = null
    }

    async loadUsers() {
        const loadedUsers = await this.userRepository.findAll()

        for (const user of loadedUsers) {
            this.users[user.chatID] = user
        }

        console.log(`Загружено анкет: ${loadedUsers.length}`)
    }

    async saveAllUsers() {
        await this.userRepository.saveAll(this.users)
    }

    startAutoSave() {
        this.saveInterval = setInterval(() => {
            this.saveAllUsers().catch(error => {
                console.error('Ошибка сохранения анкет:', error)
            })
        }, 5000)
    }

    registerCommands() {
        this.bot.setMyCommands([
            {
                command: 'start',
                description: 'Запустить бота, начать все заново'
            },
            {
                command: 'profile',
                description: 'Посмотреть свою анкету'
            },
            {
                command: 'lenta',
                description: 'Смотреть анкеты пользователей'
            }
        ])
    }

    async start() {
        try {

            await initDatabase()

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