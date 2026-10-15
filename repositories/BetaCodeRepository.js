// Учёт одноразовых бета-кодов закрытого тестового бота.
//
// Таблица beta_codes хранит факт использования кода (used_by), поэтому доступ
// переживает перезапуск бота. Источник допустимых кодов — текстовый файл
// (см. services/BetaAccessService.js).
class BetaCodeRepository {
    constructor(db) {
        this.db = db
    }

    // Регистрирует коды из файла: новые добавляются, уже известные не трогаются.
    async seedCodes(codes) {
        if (!Array.isArray(codes) || codes.length === 0) {
            return 0
        }

        const result = await this.db.query(`
            INSERT INTO beta_codes (code)
            SELECT * FROM unnest($1::text[])
            ON CONFLICT (code) DO NOTHING
        `, [codes])

        return result.rowCount
    }

    // Выдан ли пользователю доступ (по любому использованному им коду).
    async isGrantedTo(chatID) {
        const result = await this.db.query(
            'SELECT 1 FROM beta_codes WHERE used_by = $1 LIMIT 1',
            [String(chatID)]
        )

        return result.rowCount > 0
    }

    // Атомарно закрепляет код за пользователем. Вернёт строку только один раз:
    // повторный вызов (или гонка) получит null.
    async claim(code, chatID) {
        const result = await this.db.query(`
            UPDATE beta_codes
            SET used_by = $2, used_at = NOW()
            WHERE code = $1 AND used_by IS NULL
            RETURNING code
        `, [code, String(chatID)])

        return result.rows[0] || null
    }

    async findByCode(code) {
        const result = await this.db.query(
            'SELECT code, used_by, used_at FROM beta_codes WHERE code = $1',
            [code]
        )

        return result.rows[0] || null
    }

    async stats() {
        const result = await this.db.query(`
            SELECT count(*)::int AS total, count(used_by)::int AS used
            FROM beta_codes
        `)

        return result.rows[0] || { total: 0, used: 0 }
    }
}

module.exports = BetaCodeRepository
