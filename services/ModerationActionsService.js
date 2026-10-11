class ModerationActionsService {
    constructor({ userRepository, bot, moderationActionRepository }) {
        this.userRepository = userRepository
        this.bot = bot
        this.logRepo = moderationActionRepository
    }

    parseDuration(s) {
        if (!s) return { ms: null, human: null }
        const str = String(s).trim().toLowerCase()
        if (!str) return { ms: null, human: null }
        const m = str.match(/^(\d+)(m|h|d|y)$/)
        if (!m) return { ms: null, human: null }
        const n = parseInt(m[1])
        if (!Number.isFinite(n)) return { ms: null, human: null }
        let ms = 0, human
        switch (m[2]) {
            case 'm': ms = n * 60 * 1000; human = n === 1 ? '1 минуту' : n < 5 ? `${n} минуты` : `${n} минут`; break
            case 'h': ms = n * 3600 * 1000; human = n === 1 ? '1 час' : n < 5 ? `${n} часа` : `${n} часов`; break
            case 'd': ms = n * 86400 * 1000; human = n === 1 ? '1 день' : n < 5 ? `${n} дня` : `${n} дней`; break
            case 'y': ms = n * 365 * 86400 * 1000; human = n === 1 ? '1 год' : n < 5 ? `${n} года` : `${n} лет`; break
        }
        return { ms, human }
    }

    async getUserByChatID(chatID) {
        const users = await this.userRepository.findAll()
        return users.find(u => Number(u.chatID) === Number(chatID))
    }

    async saveUser(user) {
        if (user && typeof this.userRepository.save === 'function') {
            await this.userRepository.save(user)
        }
    }
}

module.exports = ModerationActionsService