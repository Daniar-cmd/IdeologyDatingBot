// Колонки анкеты для upsert. Порядок обязан совпадать с buildRow.
const USER_COLUMNS = [
    'chat_id', 'username', 'registered', 'name', 'gender', 'age',
    'description', 'city', 'is_global', 'hidden', 'banned', 'banned_until',
    'warnings', 'photos', 'likes', 'liked_by', 'viewed', 'matches',
    'state', 'looking_for'
].join(', ')

// При конфликте обновляем всё, кроме полей модерации
// (banned / banned_until / warnings): их намеренно меняет только
// setModerationState, чтобы автосохранение анкет не перезатирало
// баны и варны устаревшим состоянием из памяти.
const USER_UPDATE_SET = [
    'username = EXCLUDED.username',
    'registered = EXCLUDED.registered',
    'name = EXCLUDED.name',
    'gender = EXCLUDED.gender',
    'age = EXCLUDED.age',
    'description = EXCLUDED.description',
    'city = EXCLUDED.city',
    'is_global = EXCLUDED.is_global',
    'hidden = EXCLUDED.hidden',
    'photos = EXCLUDED.photos',
    'likes = EXCLUDED.likes',
    'liked_by = EXCLUDED.liked_by',
    'viewed = EXCLUDED.viewed',
    'matches = EXCLUDED.matches',
    'state = EXCLUDED.state',
    'looking_for = EXCLUDED.looking_for'
].join(', ')

// Максимум строк в одном батч-upsert: 200 × 20 = 4000 параметров,
// с запасом ниже лимита PostgreSQL (65535).
const SAVE_BATCH_SIZE = 200

class UserRepository {
    constructor(db, User) {
        this.db = db
        this.User = User
    }

    async findAll({ orderByCreatedAtDesc = false, limit, offset } = {}) {
        const params = []
        let query = 'SELECT * FROM users'

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

    // Преобразует модель пользователя в массив значений для upsert.
    // Порядок строго совпадает с USER_COLUMNS.
    buildRow(user) {
        const state = Object.keys(user).find(
            key =>
                key.startsWith('waitingFor') &&
                user[key] === true
        ) || null

        return [
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
        ]
    }

    async save(user) {
        const values = this.buildRow(user)
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')

        await this.db.query(`
            INSERT INTO users (${USER_COLUMNS})
            VALUES (${placeholders})
            ON CONFLICT (chat_id) DO UPDATE SET ${USER_UPDATE_SET}
        `, values)
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

    // Сохраняет всех пользователей одним батч-upsert вместо отдельного
    // запроса на каждого: с удалённой БД цикл автосохранения раз в 5 секунд
    // раньше заметно нагружал соединение и рос линейно по числу анкет.
    async saveAll(users) {
        const list = Object.values(users)

        for (let start = 0; start < list.length; start += SAVE_BATCH_SIZE) {
            const chunk = list.slice(start, start + SAVE_BATCH_SIZE)
            const params = []
            const tuples = chunk.map(user => {
                const placeholders = this.buildRow(user).map(value => {
                    params.push(value)
                    return `$${params.length}`
                })

                return `(${placeholders.join(', ')})`
            })

            await this.db.query(`
                INSERT INTO users (${USER_COLUMNS})
                VALUES ${tuples.join(', ')}
                ON CONFLICT (chat_id) DO UPDATE SET ${USER_UPDATE_SET}
            `, params)
        }
    }
}

module.exports = UserRepository