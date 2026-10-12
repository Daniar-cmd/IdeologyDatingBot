class ReportRepository {
    constructor(db) {
        this.db = db
    }

    async create(report) {
        const result = await this.db.query(
            `INSERT INTO reports (reporter_chat_id, reported_chat_id, reason, status)
             VALUES ($1, $2, $3, 'new')
             RETURNING id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at, resolved_by, resolved_action`,
            [
                String(report.reporterChatID),
                String(report.reportedChatID),
                report.reason
            ]
        )

        return result.rows[0] || null
    }

    async findById(id) {
        const result = await this.db.query(
            `SELECT id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at, resolved_by, resolved_action
             FROM reports
             WHERE id = $1`,
            [id]
        )

        return result.rows[0] || null
    }

    // Обновляет статус жалобы. Дополнительно можно сохранить автора приговора
    // и наказание (resolvedBy/resolvedAction). COALESCE не даёт стереть уже
    // записанные значения при вызове без этих аргументов.
    async setStatus(id, status, { resolvedBy = null, resolvedAction = null } = {}) {
        const result = await this.db.query(
            `UPDATE reports
             SET status = $2,
                 processed_at = NOW(),
                 resolved_by = COALESCE($3, resolved_by),
                 resolved_action = COALESCE($4, resolved_action)
             WHERE id = $1
             RETURNING id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at, resolved_by, resolved_action`,
            [id, status, resolvedBy, resolvedAction]
        )

        return result.rows[0] || null
    }

    // Страница жалоб (новые сверху) с юзернеймами отправителя и получателя.
    async findAllWithUsers({ limit, offset } = {}) {
        const result = await this.db.query(
            `SELECT r.id, r.reporter_chat_id, r.reported_chat_id, r.reason, r.status,
                    r.created_at, r.processed_at, r.resolved_by, r.resolved_action,
                    reporter.username AS reporter_username,
                    reported.username AS reported_username
             FROM reports r
             LEFT JOIN users reporter ON reporter.chat_id = r.reporter_chat_id
             LEFT JOIN users reported ON reported.chat_id = r.reported_chat_id
             ORDER BY r.created_at DESC NULLS LAST, r.id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        )

        return result.rows
    }

    // Общее число жалоб.
    async countAll() {
        const result = await this.db.query('SELECT COUNT(*)::int AS count FROM reports')
        return result.rows[0]?.count || 0
    }
}

module.exports = ReportRepository