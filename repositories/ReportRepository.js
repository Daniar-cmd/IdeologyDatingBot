class ReportRepository {
    constructor(db) {
        this.db = db
    }

    async create(report) {
        const result = await this.db.query(
            `INSERT INTO reports (reporter_chat_id, reported_chat_id, reason, status)
             VALUES ($1, $2, $3, 'new')
             RETURNING id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at`,
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
            `SELECT id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at
             FROM reports
             WHERE id = $1`,
            [id]
        )

        return result.rows[0] || null
    }

    async setStatus(id, status) {
        const result = await this.db.query(
            `UPDATE reports
             SET status = $2, processed_at = NOW()
             WHERE id = $1
             RETURNING id, reporter_chat_id, reported_chat_id, reason, status, created_at, processed_at`,
            [id, status]
        )

        return result.rows[0] || null
    }
}

module.exports = ReportRepository