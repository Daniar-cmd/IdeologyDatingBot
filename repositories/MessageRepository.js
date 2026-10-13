// Доступ к таблице messages: личные сообщения, прикреплённые к лайку.
class MessageRepository {
    constructor(db) {
        this.db = db
    }

    async create(fromChatID, toChatID, text) {
        const result = await this.db.query(
            `INSERT INTO messages (from_chat_id, to_chat_id, text)
             VALUES ($1, $2, $3)
             RETURNING id, from_chat_id, to_chat_id, text, created_at`,
            [String(fromChatID), String(toChatID), text]
        )

        return result.rows[0]
    }

    // Удаляет все сообщения пользователя (как отправленные, так и полученные).
    // Используется при пересоздании анкеты: история должна обнулиться.
    async deleteForUser(chatID) {
        await this.db.query(
            `DELETE FROM messages WHERE from_chat_id = $1 OR to_chat_id = $1`,
            [String(chatID)]
        )
    }

    // Сообщения от одного пользователя другому в хронологическом порядке.
    async listFromTo(fromChatID, toChatID, limit = 20) {
        const result = await this.db.query(
            `SELECT id, from_chat_id, to_chat_id, text, created_at
             FROM messages
             WHERE from_chat_id = $1 AND to_chat_id = $2
             ORDER BY created_at DESC
             LIMIT $3`,
            [String(fromChatID), String(toChatID), limit]
        )

        return result.rows.reverse()
    }
}

module.exports = MessageRepository
