const fs = require('fs')
const path = require('path')

// Читатель реестра кастомных консольных команд (console.txt).
class ConsoleRegistry {
    constructor(filePath = path.join(__dirname, '..', 'console.txt')) {
        this.filePath = filePath
    }

    // Возвращает список команд: [{ name, run, description }].
    // Формат строки: <команда> | <запуск> | <описание>
    list() {
        if (!fs.existsSync(this.filePath)) {
            return []
        }

        const content = fs.readFileSync(this.filePath, 'utf8')

        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                const parts = line.split('|').map(part => part.trim())
                const [name, run, description = ''] = parts

                if (!name || !run) {
                    return null
                }

                return { name, run, description }
            })
            .filter(Boolean)
    }
}

module.exports = ConsoleRegistry