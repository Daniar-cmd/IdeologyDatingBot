const fs = require('fs')
const path = require('path')

const BetaAccessService = require('../services/BetaAccessService')

// Генератор бета-кодов: дописывает N новых уникальных кодов в файл, не трогая
// уже существующие. Если файла нет — создаёт его с заголовком.
// Запуск: npm run beta:codes -- 20   (без числа — 99 кодов).
const count = Number(process.argv[2]) || 99
const filePath = process.env.BETA_CODES_FILE || path.resolve(__dirname, '..', 'beta_codes.txt')

const HEADER = [
    '# Бета-коды тестового бота. Один код — один вход.',
    '# Формат: 16 символов [a-z0-9]. Пополнить: npm run beta:codes -- 20'
].join('\n') + '\n'

function main() {
    let content = ''
    let exists = false

    try {
        content = fs.readFileSync(filePath, 'utf8')
        exists = true
    } catch (error) {
        exists = false
    }

    const existing = exists ? BetaAccessService.parseCodes(content) : []
    const fresh = BetaAccessService.generateCodes(count, existing)

    let output = ''

    if (!exists) {
        output += HEADER
    } else if (content && !content.endsWith('\n')) {
        output += '\n'
    }

    output += fresh.join('\n') + '\n'

    fs.appendFileSync(filePath, output, 'utf8')

    console.log(`Файл: ${filePath}`)
    console.log(`Добавлено кодов: ${fresh.length} (всего в файле: ${existing.length + fresh.length})`)
}

main()
