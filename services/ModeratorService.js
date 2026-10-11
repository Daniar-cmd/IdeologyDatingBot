class ModeratorService {
    constructor(moderatorRepository, freezeHours = 24) {
        this.moderatorRepository = moderatorRepository
        // Срок заморозки модератора за неверные ключи
        this.freezeHours = freezeHours
    }

    // Возвращает Date, если модератор заморожен, иначе null.
    async getFreezeUntil(chatID) {
        if (!this.moderatorRepository) {
            return null
        }

        const row = await this.moderatorRepository.find(chatID)

        if (!row) {
            return null
        }

        const until = new Date(row.frozen_until)

        if (Number.isNaN(until.getTime())) {
            return null
        }

        // Срок истёк — снимаем заморозку автоматически
        if (until.getTime() <= Date.now()) {
            await this.moderatorRepository.clearFreeze(chatID)
            return null
        }

        return until
    }

    async isFrozen(chatID) {
        return Boolean(await this.getFreezeUntil(chatID))
    }

    // Замораживает модератора и возвращает дату окончания заморозки.
    async freeze(chatID) {
        const until = new Date(Date.now() + this.freezeHours * 60 * 60 * 1000)
        await this.moderatorRepository.setFreeze(chatID, until)
        return until
    }
}

module.exports = ModeratorService
