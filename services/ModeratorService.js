const crypto = require('crypto')

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

    // ---------- Модераторы и приглашения ----------

    // 4-значный код приглашения (с ведущими нулями).
    generateInviteCode() {
        return String(crypto.randomInt(0, 10000)).padStart(4, '0')
    }

    // 6-значный личный admin-ключ.
    generateAdminPin() {
        return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    }

    async listModerators() {
        return this.moderatorRepository.listModerators()
    }

    async listPendingInvites() {
        return this.moderatorRepository.listPendingInvites()
    }

    // Приглашения, которые бот ещё не доставил приглашённому.
    async listPendingUnnotifiedInvites() {
        return this.moderatorRepository.listPendingUnnotifiedInvites()
    }

    // Атомарно забирает приглашение под отправку (true вернётся один раз).
    async claimInviteNotification(chatID) {
        return this.moderatorRepository.claimInviteNotification(chatID)
    }

    // Возвращает приглашение в очередь отправки после неудачной попытки.
    async releaseInviteNotification(chatID) {
        return this.moderatorRepository.releaseInviteNotification(chatID)
    }

    // Текст приглашения и кнопки — общие для отправителя (бот в Telegram).
    inviteMessage() {
        return {
            text: '🔔 Вас пригласили стать модератором IdeologyDatingBot.\n\n' +
                'Если вы согласны, нажмите «✅ Принять» и введите 4-значный код, который передал администратор.',
            options: {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Принять', callback_data: 'mod_invite_accept' },
                        { text: '❌ Отказаться', callback_data: 'mod_invite_decline' }
                    ]]
                }
            }
        }
    }

    async listActiveModerators() {
        return this.moderatorRepository.listActiveModerators()
    }

    // Создаёт (или пересоздаёт) приглашение и возвращает его код.
    async createInvite(chatID, invitedBy) {
        const code = this.generateInviteCode()
        await this.moderatorRepository.setInvite(chatID, { code, invitedBy })
        return code
    }

    // Активное (ещё не принятое/не отклонённое) приглашение либо null.
    async getPendingInvite(chatID) {
        const invite = await this.moderatorRepository.findInvite(chatID)

        if (!invite || invite.status !== 'pending') {
            return null
        }

        return invite
    }

    // Проверяет код и превращает приглашённого в модератора с личными ключами.
    // Возвращает { ok, pin1, pin2, invitedBy } либо { ok: false, error }.
    async acceptInvite(chatID, code, { username = null, name = null } = {}) {
        const invite = await this.getPendingInvite(chatID)

        if (!invite) {
            return { ok: false, error: 'not_found' }
        }

        if (String(code) !== String(invite.invite_code)) {
            return { ok: false, error: 'invalid_code' }
        }

        const pin1 = this.generateAdminPin()
        const pin2 = this.generateAdminPin()

        await this.moderatorRepository.setModerator(chatID, {
            username,
            name,
            pin1,
            pin2,
            addedBy: invite.invited_by || null
        })

        await this.moderatorRepository.setInviteStatus(chatID, 'accepted')

        return { ok: true, pin1, pin2, invitedBy: invite.invited_by || null }
    }

    // Отклонение приглашения самим пользователем.
    async declineInvite(chatID) {
        const invite = await this.getPendingInvite(chatID)

        if (!invite) {
            return false
        }

        await this.moderatorRepository.setInviteStatus(chatID, 'declined')
        return true
    }

    // Снятие прав модератора и отмена его незавершённого приглашения.
    async removeModerator(chatID) {
        const existing = await this.moderatorRepository.findModerator(chatID)

        await this.moderatorRepository.deactivateModerator(chatID)

        const invite = await this.getPendingInvite(chatID)

        if (invite) {
            await this.moderatorRepository.setInviteStatus(chatID, 'cancelled')
        }

        return existing
    }
}

module.exports = ModeratorService
