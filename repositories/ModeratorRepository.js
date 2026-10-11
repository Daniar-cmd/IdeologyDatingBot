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
}

module.exports = ModeratorRepository
