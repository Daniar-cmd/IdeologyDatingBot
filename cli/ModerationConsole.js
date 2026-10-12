const readline = require('readline')
const crypto = require('crypto')

// Консольная панель модерации: вход по имени модератора и его личному паролю,
// далее — локальное меню. Действия модерации выполняются через ModerationActionsService.
class ModerationConsole {
    constructor({ input, output, accounts = [], userRepository = null, moderationActions = null }) {
        this.input = input
        this.output = output
        // Имена модераторов сравниваем без учёта регистра
        this.accounts = new Map(
            accounts.map(({ name, password, telegramID }) => [
                String(name).toLowerCase(),
                { name, password, telegramID }
            ])
        )
        this.userRepository = userRepository
        this.moderationActions = moderationActions
        this.muted = false

        this.rl = readline.createInterface({
            input: this.input,
            output: this.output,
            terminal: Boolean(this.input.isTTY && this.output.isTTY)
        })

        // Маскируем ввод пароля: типизированные символы не выводятся
        const originalWrite = this.rl._writeToOutput.bind(this.rl)
        this.rl._writeToOutput = (string) => {
            if (this.muted) {
                return
            }
            originalWrite(string)
        }

        this.rl.on('SIGINT', () => {
            this.output.write('\n👋 До свидания!\n')
            this.close()
        })

        this.menuItems = new Map([
            ['1', 'Список пользователей'],
            ['2', 'Репорты'],
            ['3', 'Заблокированные пользователи'],
            ['4', 'История модерации']
        ])

        this.USERS_PER_PAGE = 50
    }

    close() {
        if (this.rl && !this.rl.closed) {
            this.rl.close()
        }
    }

    // Вход: имя модератора -> пароль -> меню. Возвращает true/false.
    async start(name) {
        let resolvedName = String(name || '').trim()

        // Имя можно не передавать аргументом (например, старый npm не прокидывает аргументы) —
        // тогда спрашиваем его интерактивно.
        if (!resolvedName) {
            resolvedName = (await this.ask('👤 Имя модератора: ')).trim()
        }

        const account = this.accounts.get(resolvedName.toLowerCase())

        if (!account) {
            const configured = [...this.accounts.values()].map(item => item.name).join(', ') || '(нет)'
            this.output.write(`❌ Модератор «${resolvedName}» не найден. Настроенные модераторы: ${configured}\n`)
            this.close()
            return false
        }

        const password = await this.askSecret('🔑 Пароль модератора: ')
        // Убираем возможные \r/\n, которые иногда проскакивают в не-TTY окружении (веб-консоль сервера)
        const normalized = String(password ?? '').replace(/[\r\n]+$/, '')

        if (!this.verifyPassword(normalized, account.password)) {
            this.output.write('❌ Неверный пароль. Доступ запрещён.\n')
            this.output.write('ℹ️  Пароль берётся из MODERATOR_ACCOUNTS. Переменные окружения имеют приоритет над .env.\n')
            this.close()
            return false
        }

        this.output.write(`✅ Вход выполнен. Модератор: ${account.name}\n`)
        await this.menuLoop(account)
        this.close()
        return true
    }

    async menuLoop(account) {
        while (true) {
            this.printHeader(account)
            this.printMenu()

            const choice = (await this.ask('\nВыберите пункт: ')).trim()

            if (choice === '0') {
                this.output.write('👋 До свидания!\n')
                return
            }

            if (choice === '1') {
                await this.showUsersList(account)
                continue
            }

            if (this.menuItems.has(choice)) {
                const section = this.menuItems.get(choice)
                this.output.write(`\n📁 Раздел «${section}» — в разработке.\n\n`)
                continue
            }

            this.output.write('❌ Неверный пункт. Выберите 1–4 или 0.\n\n')
        }
    }

    printHeader(account) {
        const border = '='.repeat(32)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Moderation ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Модератор: ${account.name}\n`)
    }

    printMenu() {
        this.output.write('\nМеню:\n')
        this.output.write('1. Список пользователей\n')
        this.output.write('2. Репорты\n')
        this.output.write('3. Заблокированные пользователи\n')
        this.output.write('4. История модерации\n')
        this.output.write('0. Выход.\n')
    }

    // Обычный вопрос (ответ видим)
    ask(question) {
        return new Promise(resolve => this.rl.question(question, resolve))
    }

    // Вопрос с маскированным вводом (пароль)
    askSecret(question) {
        return new Promise(resolve => {
            this.output.write(question)
            this.muted = true
            this.rl.question('', answer => {
                this.muted = false
                this.output.write('\n')
                resolve(answer)
            })
        })
    }

    // Сравнение паролей без утечки по времени
    verifyPassword(input, expected) {
        const inputHash = crypto.createHash('sha256').update(String(input ?? '')).digest()
        const expectedHash = crypto.createHash('sha256').update(String(expected ?? '')).digest()
        return crypto.timingSafeEqual(inputHash, expectedHash)
    }

    formatDate(date) {
        if (!date) {
            return '—'
        }

        const d = new Date(date)

        if (Number.isNaN(d.getTime())) {
            return '—'
        }

        const day = String(d.getDate()).padStart(2, '0')
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const year = d.getFullYear()

        return `${day}.${month}.${year}`
    }

    // Зачёркивание текста для забаненных пользователей
    strike(text) {
        return String(text).split('').map(char => char + '\u0336').join('')
    }

    isUserBanned(user) {
        if (typeof user.isBannedNow === 'function') {
            return user.isBannedNow()
        }

        return Boolean(user.banned)
    }

    async showUsersList(account) {
        if (!this.userRepository) {
            this.output.write('\n❌ Не подключён репозиторий пользователей (userRepository).\n\n')
            return
        }

        let page = 1

        while (true) {
            const allUsers = await this.userRepository.findAll({ orderByCreatedAtDesc: true })
            const total = allUsers.length
            const totalPages = Math.max(1, Math.ceil(total / this.USERS_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.USERS_PER_PAGE
            const users = allUsers.slice(offset, offset + this.USERS_PER_PAGE)

            this.renderUsersPage(account, page, totalPages, total, users, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input === '<') {
                if (page <= 1) {
                    this.output.write('❌ Это первая страница.\n')
                } else {
                    page -= 1
                }
                continue
            }

            if (input === '>') {
                if (page >= totalPages) {
                    this.output.write('❌ Это последняя страница.\n')
                } else {
                    page += 1
                }
                continue
            }

            const parsed = this.parseAction(input)

            if (!parsed) {
                this.output.write('❌ Неверная команда. Используйте <, >, 0 или ban/varn/pardon <номер>.')
                this.output.write('\n')
                continue
            }

            await this.executeAction(account, allUsers, parsed)
        }
    }

    renderUsersPage(account, page, totalPages, total, users, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Users List ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Модератор: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (users.length === 0) {
            this.output.write('Список пользователей пуст.\n\n')
        } else {
            users.forEach((user, index) => {
                const num = offset + index + 1
                const chatID = user.chatID ?? '—'
                const username = user.username ? `@${user.username}` : 'без username'
                const created = this.formatDate(user.createdAt)
                const content = `ID: ${chatID} | username: "${username}" | ${created}`

                if (this.isUserBanned(user)) {
                    this.output.write(`[${num}] ${this.strike(content)}\n`)
                } else {
                    this.output.write(`[${num}] ${content}\n`)
                }
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
        this.output.write('Действия:\n')
        this.output.write('  ban <номер> [срок] ["причина"]      — забанить (срок: 60m, 24h, 30d, 1y)\n')
        this.output.write('  varn <номер> ["причина"]            — предупреждение (3 → бан)\n')
        this.output.write('  pardon <номер> ["комментарий"]      — разбанить\n')
    }

    // Разбирает команду вида: ban 1 24h "причина" | varn 1 "причина" | pardon 1 "комментарий"
    parseAction(input) {
        const match = String(input).trim().match(/^(ban|varn|warn|pardon)\s+(\d+)\s*(.*)$/i)

        if (!match) {
            return null
        }

        let command = match[1].toLowerCase()

        if (command === 'warn') {
            command = 'varn'
        }

        const number = parseInt(match[2], 10)
        let rest = match[3].trim()
        let durationText = null

        if (command === 'ban') {
            const durationMatch = rest.match(/^(\d+[mhdy])(?:\s+|$)(.*)$/i)

            if (durationMatch) {
                durationText = durationMatch[1].toLowerCase()
                rest = durationMatch[2].trim()
            }
        }

        let reason = null

        if (rest) {
            const quoted = rest.match(/^"([\s\S]*)"$/)
            reason = quoted ? quoted[1].trim() : rest
        }

        return { command, number, durationText, reason }
    }

    async executeAction(account, allUsers, parsed) {
        const { command, number, durationText, reason } = parsed

        if (!Number.isInteger(number) || number < 1 || number > allUsers.length) {
            this.output.write(`❌ Нет пользователя с номером ${number}.\n`)
            return
        }

        if (!this.moderationActions) {
            this.output.write('❌ Не подключён сервис модерации (moderationActions).\n')
            return
        }

        const target = allUsers[number - 1]
        const actor = { name: account.name, telegramID: account.telegramID }

        if (command === 'ban') {
            const result = await this.moderationActions.ban(target, { durationText, reason, actor })

            if (result.ok) {
                const until = result.human ? `на ${result.human}` : 'бессрочно'
                this.output.write(`✅ Пользователь [${number}] (${target.chatID}) забанен ${until}.\n`)
            } else {
                this.output.write(`❌ ${result.error}\n`)
            }
            return
        }

        if (command === 'varn') {
            const result = await this.moderationActions.warn(target, { reason, actor })

            if (result.ok) {
                const tail = result.banned ? ' — достигнут лимит, пользователь забанен.' : '.'
                this.output.write(`✅ Пользователь [${number}] получил предупреждение (${result.warnings}/3)${tail}\n`)
            } else {
                this.output.write(`❌ ${result.error}\n`)
            }
            return
        }

        if (command === 'pardon') {
            const result = await this.moderationActions.pardon(target, { note: reason, actor })

            if (result.ok) {
                this.output.write(`✅ Пользователь [${number}] разбанен.\n`)
            } else {
                this.output.write(`❌ ${result.error}\n`)
            }
        }
    }
}

module.exports = ModerationConsole
