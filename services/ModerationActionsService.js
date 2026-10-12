// Бизнес-логика действий модерации (бан / варн / разбан).
// Используется консольной панелью модерации. Мутирует модель User,
// сохраняет состояние модерации в БД, уведомляет пользователя в Telegram
// и пишет запись в журнал moderation_actions.
class ModerationActionsService {
    constructor({ userRepository, bot = null, moderationActionRepository = null }) {
        this.userRepository = userRepository
        this.bot = bot
        this.logRepo = moderationActionRepository
    }

    // Правильная русская форма существительного после числа (винительный падеж: «на X …»).
    plural(n, one, few, many) {
        const mod10 = n % 10
        const mod100 = n % 100

        if (mod10 === 1 && mod100 !== 11) {
            return one
        }

        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
            return few
        }

        return many
    }

    // Разбирает срок вида 60m / 24h / 30d / 1y.
    // Возвращает { ms, human } либо { ms: null, human: null }, если срок не задан/некорректен.
    parseDuration(s) {
        if (!s) return { ms: null, human: null }
        const str = String(s).trim().toLowerCase()
        if (!str) return { ms: null, human: null }
        const m = str.match(/^(\d+)(m|h|d|y)$/)
        if (!m) return { ms: null, human: null }
        const n = parseInt(m[1])
        if (!Number.isFinite(n) || n <= 0) return { ms: null, human: null }
        let ms = 0, human
        switch (m[2]) {
            case 'm': ms = n * 60 * 1000; human = `${n} ${this.plural(n, 'минуту', 'минуты', 'минут')}`; break
            case 'h': ms = n * 3600 * 1000; human = `${n} ${this.plural(n, 'час', 'часа', 'часов')}`; break
            case 'd': ms = n * 86400 * 1000; human = `${n} ${this.plural(n, 'день', 'дня', 'дней')}`; break
            case 'y': ms = n * 365 * 86400 * 1000; human = `${n} ${this.plural(n, 'год', 'года', 'лет')}`; break
        }
        return { ms, human }
    }

    async getUserByChatID(chatID) {
        const users = await this.userRepository.findAll()
        return users.find(u => Number(u.chatID) === Number(chatID))
    }

    // Отображаемое имя того, кто выполнил действие (@username / имя / id).
    actorLabel(actor) {
        if (!actor) {
            return null
        }

        if (actor.name) {
            return String(actor.name)
        }

        if (actor.telegramID) {
            return String(actor.telegramID)
        }

        return null
    }

    async persist(target) {
        if (target && typeof this.userRepository.setModerationState === 'function') {
            await this.userRepository.setModerationState(target.chatID, {
                banned: target.banned,
                warnings: target.warnings,
                bannedUntil: target.bannedUntil || null,
                bannedAt: target.bannedAt || null,
                bannedBy: target.bannedBy || null,
                banReason: target.banReason || null
            })
        }
    }

    async notify(chatID, text) {
        if (!this.bot || !chatID) {
            return
        }

        try {
            await this.bot.sendMessage(chatID, text)
        } catch (error) {
            console.error(`Не удалось уведомить пользователя ${chatID}:`, error.message)
        }
    }

    async log(action, actor, target, { durationMs = null, reason = null, note = null } = {}) {
        if (!this.logRepo || typeof this.logRepo.log !== 'function') {
            return
        }

        try {
            await this.logRepo.log({
                action,
                moderatorName: actor?.name || null,
                moderatorTelegramID: actor?.telegramID ?? null,
                targetChatID: target?.chatID ?? null,
                targetUsername: target?.username || null,
                durationMs,
                reason,
                note
            })
        } catch (error) {
            console.error('Не удалось записать действие модерации:', error.message)
        }
    }

    // Бан. durationText необязателен (без него — бессрочный бан), reason необязателен.
    async ban(target, { durationText = null, reason = null, actor = null } = {}) {
        if (!target) {
            return { ok: false, error: 'Пользователь не найден.' }
        }

        const { ms, human } = this.parseDuration(durationText)
        const bannedUntil = ms ? new Date(Date.now() + ms) : null

        target.applyBan()
        target.bannedUntil = bannedUntil
        target.bannedAt = new Date()
        target.bannedBy = this.actorLabel(actor)
        target.banReason = reason || null
        await this.persist(target)

        const suffix = human ? ` на ${human}` : ''
        const reasonText = reason ? `\n\nПричина: ${reason}` : ''
        await this.notify(target.chatID, `⛔ Вы были забанены${suffix}.${reasonText}`)
        await this.log('ban', actor, target, { durationMs: ms, reason })

        return { ok: true, human, bannedUntil }
    }

    // Варн. Третье предупреждение автоматически банит (логика в User.applyWarning).
    async warn(target, { reason = null, actor = null } = {}) {
        if (!target) {
            return { ok: false, error: 'Пользователь не найден.' }
        }

        const result = target.applyWarning()

        if (target.banned) {
            target.bannedAt = target.bannedAt || new Date()
            target.bannedBy = target.bannedBy || this.actorLabel(actor)
            target.banReason = target.banReason || reason || null
        }

        await this.persist(target)

        const reasonText = reason ? `\n\nПричина: ${reason}` : ''
        await this.notify(target.chatID, `⚠️ Вы получили предупреждение.${reasonText}`)

        if (result.banned) {
            await this.notify(target.chatID, '⛔ Вы набрали 3 предупреждения — доступ к боту закрыт. Вы забанены.')
        }

        await this.log('warn', actor, target, { reason })

        return { ok: true, warnings: result.warnings, banned: result.banned }
    }

    // Разбан. Комментарий модератора (note) пользователю не показывается, только в журнал.
    async pardon(target, { note = null, actor = null } = {}) {
        if (!target) {
            return { ok: false, error: 'Пользователь не найден.' }
        }

        target.banned = false
        target.bannedUntil = null
        await this.persist(target)

        await this.notify(target.chatID, '✅ Вы были разблокированы!')
        await this.log('pardon', actor, target, { note })

        return { ok: true }
    }

    // Перевод временного бана в бессрочный.
    async permanent(target, { actor = null } = {}) {
        if (!target) {
            return { ok: false, error: 'Пользователь не найден.' }
        }

        if (typeof target.isBannedNow === 'function' && !target.isBannedNow()) {
            return { ok: false, error: 'Пользователь не забанен.' }
        }

        if (!target.bannedUntil) {
            return { ok: false, error: 'Пользователь уже забанен бессрочно.' }
        }

        target.banned = true
        target.bannedUntil = null
        await this.persist(target)

        await this.notify(target.chatID, '⛔ Блокировка изменена на бессрочную.')
        await this.log('permanent', actor, target, { reason: target.banReason })

        return { ok: true }
    }

    // Продление временного бана: срок добавляется к текущей дате окончания.
    async extend(target, { durationText = null, actor = null } = {}) {
        if (!target) {
            return { ok: false, error: 'Пользователь не найден.' }
        }

        if (typeof target.isBannedNow === 'function' && !target.isBannedNow()) {
            return { ok: false, error: 'Пользователь не забанен.' }
        }

        if (!target.bannedUntil) {
            return { ok: false, error: 'Бан бессрочный — продлевать нечего.' }
        }

        const { ms, human } = this.parseDuration(durationText)

        if (!ms) {
            return { ok: false, error: 'Некорректный срок. Примеры: 30m, 24h, 7d, 1y.' }
        }

        const base = target.bannedUntil.getTime() > Date.now() ? target.bannedUntil.getTime() : Date.now()
        target.bannedUntil = new Date(base + ms)
        await this.persist(target)

        await this.notify(target.chatID, `⛔ Срок блокировки продлён на ${human}.`)
        await this.log('extend', actor, target, { durationMs: ms })

        return { ok: true, human, bannedUntil: target.bannedUntil }
    }
}

module.exports = ModerationActionsService
