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
}

module.exports = ModerationActionRepository