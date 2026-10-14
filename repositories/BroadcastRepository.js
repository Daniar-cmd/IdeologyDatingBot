// Рассылки («Радио»): хранение заданий на рассылку и их результатов.
// Консоль создаёт запись (status = 'pending'), бот после подтверждения
// модератором рассылает пост и помечает запись отправленной (status = 'sent').
class BroadcastRepository {
    constructor(db) {
        this.db = db
    }

    // Создаёт задание на рассылку. Аудитория хранится как есть:
    // cities — список городов строкой через запятую (или null).
    async create({
        author = null,
        moderatorChatID = null,
        moderatorUsername = null,
        gender = null,
        cities = null,
        isGlobal = false,
        ageFrom = null,
        ageTo = null
    }) {
        const result = await this.db.query(`
            INSERT INTO broadcasts
                (author, moderator_chat_id, moderator_username, gender, cities, is_global, age_from, age_to, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING *
        `, [
            author,
            moderatorChatID === null ? null : String(moderatorChatID),
            moderatorUsername,
            gender,
            cities,
            isGlobal ? true : false,
            ageFrom,
            ageTo
        ])

        return result.rows[0] || null
    }

    async findByID(id) {
        const result = await this.db.query(
            'SELECT * FROM broadcasts WHERE id = $1',
            [Number(id)]
        )

        return result.rows[0] || null
    }

    async countAll() {
        const result = await this.db.query('SELECT COUNT(*)::int AS count FROM broadcasts')
        return result.rows[0]?.count || 0
    }

    // Свежие рассылки — вверху.
    async getPage(limit, offset) {
        const params = []
        let query = 'SELECT * FROM broadcasts ORDER BY created_at DESC NULLS LAST, id DESC'

        if (typeof limit === 'number') {
            params.push(limit)
            query = `${query} LIMIT $${params.length}`

            if (typeof offset === 'number') {
                params.push(offset)
                query = `${query} OFFSET $${params.length}`
            }
        }

        const result = await this.db.query(query, params)

        return result.rows
    }

    // Помечает рассылку отправленной и сохраняет контент и итоги доставки.
    async markSent(id, { contentText = null, photoFileID = null, total = 0, sent = 0, failed = 0 }) {
        const result = await this.db.query(`
            UPDATE broadcasts
            SET status = 'sent',
                content_text = $2,
                photo_file_id = $3,
                total = $4,
                sent_count = $5,
                failed_count = $6,
                sent_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [Number(id), contentText, photoFileID, total, sent, failed])

        return result.rows[0] || null
    }
}

module.exports = BroadcastRepository
