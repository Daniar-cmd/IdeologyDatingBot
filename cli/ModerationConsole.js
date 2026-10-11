const readline = require('readline')
const crypto = require('crypto')

// Консольная панель модерации: вход по имени модератора и его личному паролю,
// далее — локальное меню. Внутренняя логика разделов добавляется позже.
class ModerationConsole {
    constructor({ input, output, accounts = [], userRepository = null, moderationActions = null }) {
        this.input = input
        this.output = output
        this.accounts = new Map(
            accounts.map(({ name, password, telegramID }) => [name, { name, password, telegramID }])
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
            this.rl.close()
            process.exit(0)
        })

        this.menuItems = new Map([
            ['1', 'Список пользователей'],
            ['2', 'Репорты'],
            ['3', 'Заблокированные пользователи'],
            ['4', 'История модерации']
        ])

        this.USERS_PER_PAGE = 50
    }

    // Вход: имя модератора -> пароль -> меню. Возвращает true/false.
    async start(name) {
        const account = this.accounts.get(name)

        if (!account) {
            this.output.write(`❌ Модератор «${name}» не найден.\n`)
            return false
        }

        const password = await this.askSecret('🔑 Пароль модератора: ')

        if (!this.verifyPassword(password, account.password)) {
            this.output.write('❌ Неверный пароль. Доступ запрещён.\n')
            return false
        }

        this.output.write(`✅ Вход выполнен. Модератор: ${account.name}\n`)
        await this.menuLoop(account)
        return true
    }

    async menuLoop(account) {
        while (true) {
            this.printHeader(account)
            this.printMenu()

            const choice = (await this.ask('\nВыберите пункт: ')).trim()

            if (choice === '0') {
                this.output.write('👋 До свидания!\n')
                this.rl.close()
                return
            }

            if (this.menuItems.has(choice)) {
                const section = this.menuItems.get(choice)

                if (choice === '1') {
                    await this.showUsersList(account)
                    continue
                }

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
        const inputHash = crypto.createHash('sha256').update(String(input)).digest()
        const expectedHash = crypto.createHash('sha256').update(String(expected)).digest()
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

    async showUsersList(account, page = 1) {
        if (!this.userRepository) {
            this.output.write('\n❌ Не подключён репозиторий пользователей (userRepository).\n\n')
            return
        }

        const offset = (page - 1) * this.USERS_PER_PAGE
        const allUsers = await this.userRepository.findAll({ orderByCreatedAtDesc: true })
        const total = allUsers.length
        const users = allUsers.slice(offset, offset + this.USERS_PER_PAGE)
        const totalPages = Math.max(1, Math.ceil(total / this.USERS_PER_PAGE))

        if (page > totalPages) {
            await this.showUsersList(account, totalPages)
            return
        }

        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Users List ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Модератор: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (users.length === 0) {
            this.output.write('Список пользователей пуст.\n\n')
            return
        }

        users.forEach((user, index) => {
            const num = offset + index + 1
            const chatID = user.chatID ?? '—'
            const username = user.username ? `@${user.username}` : 'без username'
            const created = this.formatDate(user.createdAt)
            this.output.write(`[${num}] ID: ${chatID} | username: "${username}" | ${created}\n`)
        })

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница\n')
        this.output.write('0  — вернуться в главное меню\n')

        const choice = (await this.ask('\nВведите команду: ')).trim()

        if (choice === '0') {
            return
        }

        if (choice === '<') {
            if (page <= 1) {
                this.output.write('❌ Это первая страница.\n\n')
                await this.showUsersList(account, page)
                return
            }
            await this.showUsersList(account, page - 1)
            return
        }

        if (choice === '>') {
            if (page >= totalPages) {
                this.output.write('❌ Это последняя страница.\n\n')
                await this.showUsersList(account, page)
                return
            }
            await this.showUsersList(account, page + 1)
            return
        }

        this.output.write('❌ Неверная команда. Используйте <, >, 0.\n\n')
        await this.showUsersList(account, page)
    }
}

module.exports = ModerationConsole