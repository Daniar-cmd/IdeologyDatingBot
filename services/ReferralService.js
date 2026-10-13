// Реферальная механика: учёт приглашённых по ссылке и построение ссылки.
// Счётчик пока ни на что не влияет — показываем его в /ref.
class ReferralService {
    constructor(referralRepository) {
        this.referralRepository = referralRepository
    }

    // Разбирает payload команды /start вида "ref_123". Возвращает chatID
    // пригласившего или null, если payload не реферальный.
    parseStartPayload(payload) {
        const match = /^ref_(\d+)$/.exec(String(payload || '').trim())

        if (!match) {
            return null
        }

        const referrerID = Number(match[1])

        return Number.isInteger(referrerID) ? referrerID : null
    }

    // Запоминает приход по ссылке. В счётчик это попадёт только после того,
    // как приглашённый заполнит анкету (markProfileCompleted).
    async registerVisit(referrerChatID, referredChatID) {
        const referrerID = Number(referrerChatID)
        const referredID = Number(referredChatID)

        if (!Number.isInteger(referrerID) || !Number.isInteger(referredID)) {
            return { success: false }
        }

        // Своя же ссылка не считается.
        if (referrerID === referredID) {
            return { success: false }
        }

        await this.referralRepository.createPending(referrerID, referredID)

        return { success: true }
    }

    // Приглашённый заполнил анкету — засчитываем реферал.
    async markProfileCompleted(referredChatID) {
        const referredID = Number(referredChatID)

        if (!Number.isInteger(referredID)) {
            return
        }

        await this.referralRepository.markCompleted(referredID)
    }

    async countReferrals(chatID) {
        const id = Number(chatID)

        if (!Number.isInteger(id)) {
            return 0
        }

        return this.referralRepository.countCompleted(id)
    }

    buildInviteLink(chatID, botUsername) {
        return `https://t.me/${botUsername}?start=ref_${Number(chatID)}`
    }

    // Текст приглашения, который подставляется в системное окно «Поделиться».
    inviteText() {
        return 'Привет! Заходи в IdeologyDatingBot — бот для знакомств по взглядам и ценностям. Заполни анкету и посмотри, кто рядом:'
    }

    // Ссылка для кнопки «Отправить приглашение»: открывает системное окно
    // «Поделиться» с уже заполненным текстом и реферальной ссылкой.
    shareUrl(link) {
        return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(this.inviteText())}`
    }
}

module.exports = ReferralService
