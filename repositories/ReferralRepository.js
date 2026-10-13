// Рефералы: кто кого пригласил. referred_chat_id — первичный ключ,
// поэтому у одного пользователя может быть только один пригласивший.
// В счётчик идут только анкеты, доведённые до конца (completed = TRUE).
class ReferralRepository {
    constructor(db) {
        this.db = db
    }

    // Запоминает, что пользователя referredChatID пригласил referrerChatID.
    // Повторный заход уже записанного пользователя ничего не меняет.
    async createPending(referrerChatID, referredChatID) {
        await this.db.query(`
            INSERT INTO referrals (referrer_chat_id, referred_chat_id)
            VALUES ($1, $2)
            ON CONFLICT (referred_chat_id) DO NOTHING
        `, [String(referrerChatID), String(referredChatID)])
    }

    // Отмечает анкету приглашённого как заполненную. Счётчик растёт ровно
    // один раз: повторный вызов для того же пользователя ничего не меняет.
    async markCompleted(referredChatID) {
        await this.db.query(`
            UPDATE referrals
            SET completed = TRUE, completed_at = NOW()
            WHERE referred_chat_id = $1 AND completed = FALSE
        `, [String(referredChatID)])
    }

    // Число приглашённых, заполнивших анкету.
    async countCompleted(referrerChatID) {
        const result = await this.db.query(`
            SELECT COUNT(*)::int AS count
            FROM referrals
            WHERE referrer_chat_id = $1 AND completed = TRUE
        `, [String(referrerChatID)])

        return result.rows[0]?.count || 0
    }
}

module.exports = ReferralRepository
