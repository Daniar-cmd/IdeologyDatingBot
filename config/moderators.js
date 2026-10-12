// Список чатов-модераторов: MODERATORSID=[1001, 1002] или '1001,1002'
// Общий парсер для основного процесса бота (bot.js) и консольной админ-панели (moderation.js).
function parseModeratorIDs(envValue) {
    if (!envValue) {
        return []
    }

    return String(envValue)
        .replace(/[\[\]"']/g, '')
        .split(',')
        .map(part => Number(part.trim()))
        .filter(id => Number.isInteger(id) && id > 0)
}

module.exports = { parseModeratorIDs }
