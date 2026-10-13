// Бизнес-логика сообщений, прикреплённых к лайку.
// Внутри бота переписка не ведётся: сообщение — это разовый текст,
// который получатель видит на анкете отправителя.
class MessageService {
    constructor(messages) {
        this.messages = messages
    }

    async send(fromChatID, toChatID, text) {
        const fromID = Number(fromChatID)
        const toID = Number(toChatID)

        if (!Number.isFinite(fromID) || !Number.isFinite(toID)) {
            return { success: false, message: 'Некорректный получатель сообщения.' }
        }

        if (fromID === toID) {
            return { success: false, message: 'Нельзя отправить сообщение самому себе.' }
        }

        const clean = String(text || '').trim()

        if (!clean) {
            return { success: false, message: 'Пустое сообщение.' }
        }

        // Ограничение связано с лимитом подписи к фото в Telegram (1024 символа):
        // сообщение показывается прямо в подписи к анкете.
        if (clean.length > 300) {
            return { success: false, message: 'Сообщение слишком длинное (максимум 300 символов).' }
        }

        const message = await this.messages.create(fromID, toID, clean)

        return { success: true, message }
    }

    async getMessagesFrom(fromChatID, toChatID, limit = 20) {
        return this.messages.listFromTo(fromChatID, toChatID, limit)
    }

    // Стирает всю историю сообщений пользователя (при пересоздании анкеты).
    async deleteForUser(chatID) {
        return this.messages.deleteForUser(chatID)
    }
}

module.exports = MessageService
