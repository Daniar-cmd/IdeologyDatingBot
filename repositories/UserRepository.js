class UserRepository {
    constructor(db, User) {
        this.db = db
        this.User = User
    }

    async findAll({ orderByCreatedAtDesc = false, limit, offset } = {}) {
        const params = []
        let query = 'SELECT * FROM users'
        const conditions = []

        if (orderByCreatedAtDesc) {
            conditions.push('1=1')
        }

        const baseOrder = orderByCreatedAtDesc ? 'ORDER BY created_at DESC NULLS LAST, chat_id DESC' : 'ORDER BY chat_id ASC'

        if (typeof limit === 'number') {
            params.push(limit)
            const limitClause = `LIMIT $${params.length}`
            if (typeof offset === 'number') {
                params.push(offset)
                query = `${query} ${baseOrder} ${limitClause} OFFSET $${params.length}`
            } else {
                query = `${query} ${baseOrder} ${limitClause}`
            }
        } else {
            query = `${query} ${baseOrder}`
        }

        const result = await this.db.query(query, params)

        return result.rows.map(row => {
            const user = new this.User({
                chatID: Number(row.chat_id),
                username: row.username || null,
                registered: Boolean(row.registered),
                name: row.name || null,
                gender: row.gender || null,
                lookingFor: row.looking_for || null,
                age: row.age ?? null,
                description: row.description || '',
                city: row.city || null,
                isGlobal: Boolean(row.is_global),
                hidden: Boolean(row.hidden),
                banned: Boolean(row.banned),
                bannedUntil: row.banned_until ? new Date(row.banned_until) : null,
                bannedAt: row.banned_at ? new Date(row.banned_at) : null,
                bannedBy: row.banned_by || null,
                banReason: row.ban_reason || null,
                warnings: Number(row.warnings) || 0,
                photos: row.photos || [],
                likes: row.likes || [],
                likedBy: row.liked_by || [],
                viewed: row.viewed || [],
                matches: row.matches || []
            })

            if (row.state) {
                user[row.state] = true
            }

            user.createdAt = row.created_at ? new Date(row.created_at) : null

            return user
        })
    }

    async save(user) {
        const state = Object.keys(user).find(
            key =>
                key.startsWith('waitingFor') &&
                user[key] === true
        ) || null

        await this.db.query(`
            INSERT INTO users (
                chat_id,
                username,
                registered,
                name,
                gender,
                age,
                description,
                city,
                is_global,
                hidden,
                banned,
                banned_until,
                warnings,
                photos,
                likes,
                liked_by,
                viewed,
                matches,
                state,
                looking_for
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
            ON CONFLICT (chat_id) DO UPDATE SET
                username = EXCLUDED.username,
                registered = EXCLUDED.registered,
                name = EXCLUDED.name,
                gender = EXCLUDED.gender,
                age = EXCLUDED.age,
                description = EXCLUDED.description,
                city = EXCLUDED.city,
                is_global = EXCLUDED.is_global,
                hidden = EXCLUDED.hidden,
                photos = EXCLUDED.photos,
                likes = EXCLUDED.likes,
                liked_by = EXCLUDED.liked_by,
                viewed = EXCLUDED.viewed,
                matches = EXCLUDED.matches,
                state = EXCLUDED.state,
                looking_for = EXCLUDED.looking_for
        `, [
            String(user.chatID),
            user.username || null,
            user.registered ? 1 : 0,
            user.name || null,
            user.gender || null,
            user.age ?? null,
            user.description || '',
            user.city || null,
            user.isGlobal ? true : false,
            user.hidden ? true : false,
            user.banned ? true : false,
            user.bannedUntil || null,
            user.warnings || 0,
            JSON.stringify(user.photos || []),
            JSON.stringify(user.likes || []),
            JSON.stringify(user.likedBy || []),
            JSON.stringify(user.viewed || []),
            JSON.stringify(user.matches || []),
            state,
            user.lookingFor || null
        ])
    }

    // Обновляет только поля модерации. Используется консолью и Telegram-модерацией,
    // чтобы автосохранение анкет не перезатирало баны/варны устаревшим состоянием из памяти.
    // Метаданные бана (banned_at/banned_by/ban_reason) пишутся через COALESCE:
    // если значение не передано (null), уже сохранённое не затирается.
    async setModerationState(chatID, { banned, warnings, bannedUntil, bannedAt = null, bannedBy = null, banReason = null }) {
        await this.db.query(`
            UPDATE users
            SET banned = $2,
                warnings = $3,
                banned_until = $4,
                banned_at = COALESCE($5, banned_at),
                banned_by = COALESCE($6, banned_by),
                ban_reason = COALESCE($7, ban_reason)
            WHERE chat_id = $1
        `, [
            String(chatID),
            banned ? true : false,
            Number(warnings) || 0,
            bannedUntil || null,
            bannedAt || null,
            bannedBy || null,
            banReason || null
        ])
    }

    // Возвращает состояние модерации всех пользователей (для синхронизации с работающим ботом).
    async getModerationStates() {
        const result = await this.db.query(
            'SELECT chat_id, banned, warnings, banned_until FROM users'
        )

        return result.rows.map(row => ({
            chatID: Number(row.chat_id),
            banned: Boolean(row.banned),
            warnings: Number(row.warnings) || 0,
            bannedUntil: row.banned_until ? new Date(row.banned_until) : null
        }))
    }

    async saveAll(users) {
        for (const user of Object.values(users)) {
            await this.save(user)
        }
    }
}

module.exports = UserRepository