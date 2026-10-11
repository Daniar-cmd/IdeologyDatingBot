class UserRepository {
    constructor(db, User) {
        this.db = db
        this.User = User
    }

    async findAll() {
        const result = await this.db.query(
            'SELECT * FROM users'
        )

        return result.rows.map(row => {
            const user = new this.User({
                chatID: Number(row.chat_id),
                username: row.username || null,
                registered: Boolean(row.registered),
                name: row.name || null,
                gender: row.gender || null,
                age: row.age ?? null,
                description: row.description || '',
                city: row.city || null,
                isGlobal: Boolean(row.is_global),
                hidden: Boolean(row.hidden),
                banned: Boolean(row.banned),
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
                warnings,
                photos,
                likes,
                liked_by,
                viewed,
                matches,
                state
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
                banned = EXCLUDED.banned,
                warnings = EXCLUDED.warnings,
                photos = EXCLUDED.photos,
                likes = EXCLUDED.likes,
                liked_by = EXCLUDED.liked_by,
                viewed = EXCLUDED.viewed,
                matches = EXCLUDED.matches,
                state = EXCLUDED.state
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
            user.warnings || 0,
            JSON.stringify(user.photos || []),
            JSON.stringify(user.likes || []),
            JSON.stringify(user.likedBy || []),
            JSON.stringify(user.viewed || []),
            JSON.stringify(user.matches || []),
            state
        ])
    }

    async saveAll(users) {
        for (const user of Object.values(users)) {
            await this.save(user)
        }
    }
}

module.exports = UserRepository