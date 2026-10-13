const path = require('path')
const { execFileSync } = require('child_process')

// Разделители для разбора вывода git log: между полями и между записями.
const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

// История разработки для консоли: сейчас это коммиты git.
// В будущем сюда же добавятся версии (kind: 'version').
class DevHistoryService {
    constructor({ cwd = path.join(__dirname, '..'), limit = 500, runGit = null } = {}) {
        this.cwd = cwd
        this.limit = limit
        // runGit можно подменить в тестах.
        this.runGit = runGit || (() => this.readGitLog())
    }

    readGitLog() {
        const format = `%h${FIELD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`

        return execFileSync('git', ['log', `--max-count=${this.limit}`, `--pretty=format:${format}`], {
            cwd: this.cwd,
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024
        })
    }

    // Возвращает { success, entries }. При недоступном git — success: false.
    list() {
        let output

        try {
            output = this.runGit()
        } catch (error) {
            return {
                success: false,
                entries: [],
                message: 'Не удалось прочитать историю разработки (нужен доступ к git-репозиторию).'
            }
        }

        return { success: true, entries: this.parse(output) }
    }

    // Преобразует вывод git log в записи истории.
    parse(output) {
        return String(output ?? '')
            .split(RECORD_SEP)
            .map(record => record.replace(/^\s+|\s+$/g, ''))
            .filter(Boolean)
            .map((record, index) => {
                const [hash, fullHash, author, date, subject, body] = record.split(FIELD_SEP)

                return {
                    kind: 'commit',
                    number: index + 1,
                    hash: hash || '',
                    fullHash: fullHash || '',
                    author: (author || '').trim(),
                    date: date || null,
                    subject: (subject || '').trim(),
                    body: (body || '').trim()
                }
            })
    }
}

module.exports = DevHistoryService
