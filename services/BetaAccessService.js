const { randomInt } = require('crypto')
const fs = require('fs')

// Доступ к закрытому тестовому боту по одноразовым бета-кодам.
//
// Допустимые коды задаёт текстовый файл (по одному в строке; строки с # —
// комментарии). БД хранит факт использования (таблица beta_codes), поэтому
// «один код — один вход» переживает перезапуск бота. Чтобы добавить
// бета-тестеров, допиши коды в файл — новые подхватятся при старте.
//
// Код: ровно 16 символов, только цифры и латинские буквы в нижнем регистре.
const CODE_LENGTH = 16
const CODE_PATTERN = /^[a-z0-9]{16}$/
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

class BetaAccessService {
    constructor({ betaCodeRepository = null, codes = [], enabled = false } = {}) {
        this.betaCodeRepository = betaCodeRepository
        this.codes = Array.isArray(codes) ? codes.slice() : []
        this.enabled = Boolean(enabled)

        // Кэш обладателей доступа: однажды выданный код действует постоянно,
        // поэтому повторно ходить в БД на каждое сообщение не нужно.
        this.granted = new Set()
    }

    static normalize(raw) {
        return String(raw == null ? '' : raw).trim().toLowerCase()
    }

    static isValidFormat(code) {
        return CODE_PATTERN.test(String(code || ''))
    }

    // Разбор содержимого файла: пустые строки и комментарии (#) игнорируются.
    static parseCodes(content) {
        return String(content || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => BetaAccessService.normalize(line))
            .filter(code => BetaAccessService.isValidFormat(code))
    }

    // Читает коды из файла. Если файла нет — возвращает пустой список
    // (доступ будет закрыт; про это предупреждает bot.js при старте).
    static readCodesFile(filePath) {
        try {
            return BetaAccessService.parseCodes(fs.readFileSync(filePath, 'utf8'))
        } catch (error) {
            return []
        }
    }

    // n уникальных кодов, которых нет среди existing.
    static generateCodes(n, existing = []) {
        const count = Math.max(0, Number(n) || 0)
        const taken = new Set((existing || []).map(BetaAccessService.normalize))
        const codes = []

        while (codes.length < count) {
            let code = ''

            for (let i = 0; i < CODE_LENGTH; i++) {
                code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
            }

            if (taken.has(code)) {
                continue
            }

            taken.add(code)
            codes.push(code)
        }

        return codes
    }

    // Регистрирует коды файла в БД (новые; существующие не трогает).
    async seed() {
        if (!this.betaCodeRepository || this.codes.length === 0) {
            return 0
        }

        return this.betaCodeRepository.seedCodes(this.codes)
    }

    // Есть ли у пользователя доступ (по любому когда-либо введённому коду).
    async hasAccess(chatID) {
        if (!this.betaCodeRepository) {
            return false
        }

        const key = String(chatID)

        if (this.granted.has(key)) {
            return true
        }

        const granted = await this.betaCodeRepository.isGrantedTo(key)

        if (granted) {
            this.granted.add(key)
        }

        return granted
    }

    // Пытается погасить код за пользователем. Возвращает { ok, message }.
    async claim(rawCode, chatID) {
        const code = BetaAccessService.normalize(rawCode)

        if (!BetaAccessService.isValidFormat(code)) {
            return {
                ok: false,
                message: 'Код — 16 символов: цифры и латинские буквы в нижнем регистре.'
            }
        }

        if (!this.betaCodeRepository) {
            return { ok: false, message: 'Проверка кодов недоступна.' }
        }

        const claimed = await this.betaCodeRepository.claim(code, chatID)

        if (claimed) {
            this.granted.add(String(chatID))
            return { ok: true }
        }

        const existing = await this.betaCodeRepository.findByCode(code)

        if (!existing) {
            return { ok: false, message: 'Такого кода нет.' }
        }

        return { ok: false, message: 'Этот код уже использован.' }
    }

    async stats() {
        if (!this.betaCodeRepository) {
            return { total: 0, used: 0 }
        }

        return this.betaCodeRepository.stats()
    }
}

module.exports = BetaAccessService
