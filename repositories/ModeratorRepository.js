class ModeratorRepository {
    constructor(db) {
        this.db = db
    }

    async find(chatID) {
        const result = await this.db.query(
            `SELECT chat_id, frozen_until
             FROM moderator_freezes
             WHERE chat_id = $1`,
            [String(chatID)]
        )

        return result.rows[0] || null
    }

    async setFreeze(chatID, frozenUntil) {
        const result = await this.db.query(
            `INSERT INTO moderator_freezes (chat_id, frozen_until)
             VALUES ($1, $2)
             ON CONFLICT (chat_id) DO UPDATE SET frozen_until = EXCLUDED.frozen_until
             RETURNING chat_id, frozen_until`,
            [String(chatID), frozenUntil]
        )

        return result.rows[0] || null
    }

    async clearFreeze(chatID) {
        await this.db.query(
            `DELETE FROM moderator_freezes WHERE chat_id = $1`,
            [String(chatID)]
        )
    }

    // ---------- Модераторы ----------

    async findModerator(chatID) {
        const result = await this.db.query(
            `SELECT * FROM moderators WHERE chat_id = $1`,
            [String(chatID)]
        )

        return result.rows[0] || null
    }

    // Все модераторы (активные и снятые), активные сверху.
    async listModerators() {
        const result = await this.db.query(
            `SELECT * FROM moderators ORDER BY active DESC, created_at DESC NULLS LAST, chat_id ASC`
        )

        return result.rows
    }

    // Только активные модераторы (кому уходят уведомления о жалобах).
    async listActiveModerators() {
        const result = await this.db.query(
            `SELECT * FROM moderators WHERE active = TRUE ORDER BY chat_id ASC`
        )

        return result.rows
    }

    // Добавление/возврат модератора с личными admin-ключами.
    async setModerator(chatID, { username = null, name = null, pin1, pin2, addedBy = null }) {
        const result = await this.db.query(
            `INSERT INTO moderators (chat_id, username, name, pin1, pin2, added_by, active, removed_at)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE, NULL)
             ON CONFLICT (chat_id) DO UPDATE SET
                username = EXCLUDED.username,
                name = EXCLUDED.name,
                pin1 = EXCLUDED.pin1,
                pin2 = EXCLUDED.pin2,
                added_by = EXCLUDED.added_by,
                active = TRUE,
                removed_at = NULL
             RETURNING *`,
            [String(chatID), username, name, pin1, pin2, addedBy]
        )

        return result.rows[0] || null
    }

    // Снятие прав. Работает и для встроенных (MODERATORSID), которых нет в таблице:
    // создаётся запись active=false, чтобы бот исключил их из списка.
    async deactivateModerator(chatID) {
        const result = await this.db.query(
            `INSERT INTO moderators (chat_id, active, removed_at)
             VALUES ($1, FALSE, NOW())
             ON CONFLICT (chat_id) DO UPDATE SET
                active = FALSE,
                removed_at = NOW()
             RETURNING *`,
            [String(chatID)]
        )

        return result.rows[0] || null
    }

    // ---------- Приглашения ----------

    async setInvite(chatID, { code, invitedBy = null }) {
        const result = await this.db.query(
            `INSERT INTO moderator_invites (chat_id, invite_code, invited_by, status, created_at, resolved_at)
             VALUES ($1, $2, $3, 'pending', NOW(), NULL)
             ON CONFLICT (chat_id) DO UPDATE SET
                invite_code = EXCLUDED.invite_code,
                invited_by = EXCLUDED.invited_by,
                status = 'pending',
                created_at = NOW(),
                resolved_at = NULL
             RETURNING *`,
            [String(chatID), String(code), invitedBy]
        )

        return result.rows[0] || null
    }

    async findInvite(chatID) {
        const result = await this.db.query(
            `SELECT * FROM moderator_invites WHERE chat_id = $1`,
            [String(chatID)]
        )

        return result.rows[0] || null
    }

    async setInviteStatus(chatID, status) {
        const result = await this.db.query(
            `UPDATE moderator_invites
             SET status = $2, resolved_at = NOW()
             WHERE chat_id = $1
             RETURNING *`,
            [String(chatID), status]
        )

        return result.rows[0] || null
    }

    async listPendingInvites() {
        const result = await this.db.query(
            `SELECT * FROM moderator_invites WHERE status = 'pending' ORDER BY created_at DESC NULLS LAST`
        )

        return result.rows
    }
}

module.exports = ModeratorRepository
