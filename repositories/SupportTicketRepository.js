// Доступ к обращениям пользователей в поддержку (таблица support_tickets).
class SupportTicketRepository {
    constructor(db) {
        this.db = db
    }

    async create(ticket) {
        const result = await this.db.query(
            `INSERT INTO support_tickets (user_chat_id, username, type, message, status)
             VALUES ($1, $2, $3, $4, 'new')
             RETURNING id, user_chat_id, username, type, message, status, created_at, read_at, read_by, replied_at, replied_by, reply_text`,
            [
                String(ticket.userChatID),
                ticket.username || null,
                ticket.type,
                ticket.message
            ]
        )

        return result.rows[0] || null
    }

    async findById(id) {
        const result = await this.db.query(
            `SELECT id, user_chat_id, username, type, message, status, created_at, read_at, read_by, replied_at, replied_by, reply_text
             FROM support_tickets
             WHERE id = $1`,
            [id]
        )

        return result.rows[0] || null
    }

    async countAll() {
        const result = await this.db.query('SELECT COUNT(*)::int AS count FROM support_tickets')

        return result.rows[0] ? result.rows[0].count : 0
    }

    // Непрочитанные — те, по которым ни один админ ещё не выполнял read.
    async countUnread() {
        const result = await this.db.query(
            'SELECT COUNT(*)::int AS count FROM support_tickets WHERE read_at IS NULL'
        )

        return result.rows[0] ? result.rows[0].count : 0
    }

    async getPage(limit, offset) {
        const result = await this.db.query(
            `SELECT id, user_chat_id, username, type, message, status, created_at, read_at, read_by, replied_at, replied_by, reply_text
             FROM support_tickets
             ORDER BY created_at DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        )

        return result.rows
    }

    // Отметка «прочитано»: сохраняем первого админа, открывшего обращение.
    async markRead(id, adminName) {
        const result = await this.db.query(
            `UPDATE support_tickets
             SET read_at = COALESCE(read_at, NOW()),
                 read_by = COALESCE(read_by, $2),
                 status = CASE WHEN status = 'new' THEN 'read' ELSE status END
             WHERE id = $1
             RETURNING id, user_chat_id, username, type, message, status, created_at, read_at, read_by, replied_at, replied_by, reply_text`,
            [id, adminName || null]
        )

        return result.rows[0] || null
    }

    // Отметка ответа пользователю. Ответ заодно считается прочтением.
    async markReplied(id, replyText, adminName) {
        const result = await this.db.query(
            `UPDATE support_tickets
             SET replied_at = NOW(),
                 reply_text = $2,
                 replied_by = $3,
                 read_at = COALESCE(read_at, NOW()),
                 read_by = COALESCE(read_by, $3),
                 status = 'answered'
             WHERE id = $1
             RETURNING id, user_chat_id, username, type, message, status, created_at, read_at, read_by, replied_at, replied_by, reply_text`,
            [id, replyText, adminName || null]
        )

        return result.rows[0] || null
    }
}

module.exports = SupportTicketRepository
