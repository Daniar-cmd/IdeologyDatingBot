class ModerationActionRepository {
    constructor(db) {
        this.db = db
    }

    async log({
        action,
        moderatorName = null,
        moderatorTelegramID = null,
        targetChatID,
        targetUsername = null,
        durationMs = null,
        reason = null,
        note = null
    }) {
        await this.db.query(`
            INSERT INTO moderation_actions (
                action,
                moderator_name,
                moderator_telegram_id,
                target_chat_id,
                target_username,
                duration_ms,
                reason,
                note
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            action,
            moderatorName,
            moderatorTelegramID,
            targetChatID,
            targetUsername,
            durationMs,
            reason,
            note
        ])
    }

    async getAll() {
        const result = await this.db.query(
            'SELECT * FROM moderation_actions ORDER BY created_at DESC, id DESC'
        )
        return result.rows
    }

    // Страница истории действий (свежие сверху).
    async getPage({ limit, offset } = {}) {
        const result = await this.db.query(
            `SELECT id, action, moderator_name, moderator_telegram_id,
                    target_chat_id, target_username, duration_ms, reason, note, created_at
             FROM moderation_actions
             ORDER BY created_at DESC NULLS LAST, id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        )

        return result.rows
    }

    async countAll() {
        const result = await this.db.query('SELECT COUNT(*)::int AS count FROM moderation_actions')

        return result.rows[0] ? result.rows[0].count : 0
    }
}

module.exports = ModerationActionRepository