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
                photos: row.photos || [],
                likes: row.likes || [],
                likedBy: row.liked_by || [],
                viewed: row.viewed || []
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
                photos,
                likes,
                liked_by,
                viewed,
                state
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13
            )
            ON CONFLICT (chat_id) DO UPDATE SET
                username = EXCLUDED.username,
                registered = EXCLUDED.registered,
                name = EXCLUDED.name,
                gender = EXCLUDED.gender,
                age = EXCLUDED.age,
                description = EXCLUDED.description,
                city = EXCLUDED.city,
                photos = EXCLUDED.photos,
                likes = EXCLUDED.likes,
                liked_by = EXCLUDED.liked_by,
                viewed = EXCLUDED.viewed,
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
            JSON.stringify(user.photos || []),
            JSON.stringify(user.likes || []),
            JSON.stringify(user.likedBy || []),
            JSON.stringify(user.viewed || []),
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