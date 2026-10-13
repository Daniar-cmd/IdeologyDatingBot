// Бизнес-логика обращений в поддержку: приём, чтение админом, ответ пользователю.
class SupportTicketService {
    constructor(supportTicketRepository) {
        this.supportTicketRepository = supportTicketRepository
    }

    async createTicket({ chatID, username = null, type, message }) {
        if (!chatID) {
            return {
                success: false,
                message: '❌ Не удалось определить отправителя обращения.'
            }
        }

        if (type !== 'bug' && type !== 'idea') {
            return {
                success: false,
                message: '❌ Неизвестный тип обращения.'
            }
        }

        const text = String(message ?? '').trim()

        if (!text) {
            return {
                success: false,
                message: '❌ Обращение не может быть пустым.'
            }
        }

        if (text.length > 2000) {
            return {
                success: false,
                message: '❌ Обращение слишком длинное (максимум 2000 символов).'
            }
        }

        try {
            const ticket = await this.supportTicketRepository.create({
                userChatID: chatID,
                username,
                type,
                message: text
            })

            console.log(`📮 Тикет #${ticket.id} (${type}) от ${chatID}`)

            return { success: true, ticket }
        } catch (error) {
            console.error('Ошибка сохранения тикета:', error.message)

            return {
                success: false,
                message: '❌ Не удалось сохранить обращение.'
            }
        }
    }

    async getTicketsCount() {
        return this.supportTicketRepository.countAll()
    }

    async getUnreadCount() {
        return this.supportTicketRepository.countUnread()
    }

    async getTicketsPage(limit, offset) {
        return this.supportTicketRepository.getPage(limit, offset)
    }

    async getTicket(id) {
        return this.supportTicketRepository.findById(id)
    }

    // Открытие обращения: отмечаем, что админ его прочитал.
    async markRead(id, adminName) {
        try {
            const ticket = await this.supportTicketRepository.markRead(id, adminName)

            return { success: Boolean(ticket), ticket }
        } catch (error) {
            console.error('Ошибка отметки тикета прочитанным:', error.message)

            return {
                success: false,
                message: '❌ Не удалось отметить обращение прочитанным.'
            }
        }
    }

    async reply(id, text, adminName) {
        const replyText = String(text ?? '').trim()

        if (!replyText) {
            return {
                success: false,
                message: '❌ Текст ответа не может быть пустым.'
            }
        }

        try {
            const ticket = await this.supportTicketRepository.markReplied(id, replyText, adminName)

            return { success: Boolean(ticket), ticket }
        } catch (error) {
            console.error('Ошибка сохранения ответа на тикет:', error.message)

            return {
                success: false,
                message: '❌ Не удалось сохранить ответ.'
            }
        }
    }
}

module.exports = SupportTicketService
