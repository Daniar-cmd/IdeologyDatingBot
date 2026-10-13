const readline = require('readline')
const crypto = require('crypto')

// Консольная админ-панель: вход по имени администратора и его личному паролю,
// далее — локальное меню. Действия выполняются через ModerationActionsService.
class ModerationConsole {
    constructor({ input, output, accounts = [], userRepository = null, moderationActions = null, reportService = null, notifier = null, moderatorChatIDs = [], moderationActionRepository = null, moderatorService = null, supportTicketService = null, devHistoryService = null }) {
        this.input = input
        this.output = output
        // Имена администраторов сравниваем без учёта регистра
        this.accounts = new Map(
            accounts.map(({ name, password, telegramID }) => [
                String(name).toLowerCase(),
                { name, password, telegramID }
            ])
        )
        this.userRepository = userRepository
        this.moderationActions = moderationActions
        this.reportService = reportService
        this.notifier = notifier
        this.moderatorChatIDs = Array.isArray(moderatorChatIDs) ? moderatorChatIDs : []
        this.moderationActionRepository = moderationActionRepository
        this.moderatorService = moderatorService
        this.supportTicketService = supportTicketService
        this.devHistoryService = devHistoryService
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
            ['4', 'История администрирования'],
            ['5', 'Модераторы']
        ])

        this.USERS_PER_PAGE = 50
        this.REPORTS_PER_PAGE = 50
        this.BANNED_PER_PAGE = 50
        this.HISTORY_PER_PAGE = 50
        this.MODERATORS_PER_PAGE = 50
        this.TICKETS_PER_PAGE = 50
        this.DEV_HISTORY_PER_PAGE = 50
    }

    close() {
        if (this.rl && !this.rl.closed) {
            this.rl.close()
        }
    }

    // Вход: имя админа -> пароль -> меню. Возвращает true/false.
    async start(name) {
        let resolvedName = String(name || '').trim()

        // Имя администратора передаётся аргументом (npm run admin daniiar),
        // если не передано — спрашиваем интерактивно.
        if (!resolvedName) {
            resolvedName = (await this.ask('👤 Имя админа: ')).trim()
        }

        const account = this.accounts.get(resolvedName.toLowerCase())

        if (!account) {
            const configured = [...this.accounts.values()].map(item => item.name).join(', ') || '(нет)'
            this.output.write(`❌ Админ «${resolvedName}» не найден. Настроенные админы: ${configured}\n`)
            this.close()
            return false
        }

        const password = await this.askSecret('🔑 Пароль админа: ')
        // Убираем возможные \r/\n, которые иногда проскакивают в не-TTY окружении (веб-консоль сервера)
        const normalized = String(password ?? '').replace(/[\r\n]+$/, '')

        if (!this.verifyPassword(normalized, account.password)) {
            this.output.write('❌ Неверный пароль. Доступ запрещён.\n')
            this.output.write('ℹ️  Пароль берётся из MODERATOR_ACCOUNTS. Переменные окружения имеют приоритет над .env.\n')
            this.close()
            return false
        }

        this.output.write(`✅ Вход выполнен. Админ: ${account.name}\n`)
        await this.menuLoop(account)
        this.close()
        return true
    }

    async menuLoop(account) {
        while (true) {
            this.printHeader(account)
            await this.printTicketsNotice()
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

            if (choice === '2') {
                await this.showReportsList(account)
                continue
            }

            if (choice === '3') {
                await this.showBannedList(account)
                continue
            }

            if (choice === '4') {
                await this.showHistoryList(account)
                continue
            }

            if (choice === '5') {
                await this.showModeratorsList(account)
                continue
            }

            // Пункт 6 — история разработки
            if (choice === '6') {
                await this.showDevHistoryList(account)
                continue
            }

            if (choice === '7') {
                await this.showTicketsList(account)
                continue
            }

            if (this.menuItems.has(choice)) {
                const section = this.menuItems.get(choice)
                this.output.write(`\n📁 Раздел «${section}» — в разработке.\n\n`)
                continue
            }

            this.output.write('❌ Неверный пункт. Выберите 1–7 или 0.\n\n')
        }
    }

    printHeader(account) {
        const border = '='.repeat(32)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Admin ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
    }

    // В главном меню показываем число ещё не прочитанных админами обращений.
    async printTicketsNotice() {
        if (!this.supportTicketService) {
            return
        }

        let unread = 0

        try {
            unread = await this.supportTicketService.getUnreadCount()
        } catch (error) {
            return
        }

        if (unread > 0) {
            this.output.write(`📮 Непрочитанных тикетов [${unread}]\n`)
        }
    }

    printMenu() {
        this.output.write('\nМеню:\n')
        this.output.write('1. Список пользователей\n')
        this.output.write('2. Репорты\n')
        this.output.write('3. Заблокированные пользователи\n')
        this.output.write('4. История администрирования\n')
        this.output.write('5. Модераторы\n')
        this.output.write('6. История разработки\n')
        this.output.write('7. Тикеты\n')
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

    // Подтверждение действия личным пином администратора (он же пароль входа).
    // Возвращает true, только если введён верный пин; иначе действие отменяется.
    async confirmActionPin(account) {
        const input = await this.askSecret('🔐 Подтвердите действие личным пином: ')

        if (this.verifyPassword(input, account.password)) {
            return true
        }

        this.output.write('❌ Неверный пин. Действие отменено.\n')
        return false
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

            if (input.toLowerCase() === 'update') {
                continue
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
                this.output.write('❌ Неверная команда.\n')
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
        this.output.write(`Админ: ${account.name}\n`)
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
    }

    async showReportsList(account) {
        if (!this.reportService) {
            this.output.write('\n❌ Не подключён сервис репортов (reportService).\n\n')
            return
        }

        let page = 1

        while (true) {
            const total = await this.reportService.getReportsCount()
            const totalPages = Math.max(1, Math.ceil(total / this.REPORTS_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.REPORTS_PER_PAGE
            const reports = await this.reportService.getReportsPage(this.REPORTS_PER_PAGE, offset)

            this.renderReportsPage(account, page, totalPages, total, reports, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                continue
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

            const readMatch = input.match(/^read\s+(\d+)$/i)

            if (readMatch) {
                await this.showReportCard(Number(readMatch[1]), reports, offset)
                continue
            }

            const sendMatch = input.match(/^send\s+(\d+)\s+(\S+)$/i)

            if (sendMatch) {
                await this.sendReportByNumber(account, Number(sendMatch[1]), sendMatch[2], reports, offset)
                continue
            }

            this.output.write('❌ Неверная команда.\n')
        }
    }

    renderReportsPage(account, page, totalPages, total, reports, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Reports ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (reports.length === 0) {
            this.output.write('Список репортов пуст.\n\n')
        } else {
            reports.forEach((report, index) => {
                const num = offset + index + 1
                const reporter = this.describeParty(report.reporter_username, report.reporter_chat_id)
                const reported = this.describeParty(report.reported_username, report.reported_chat_id)
                const created = this.formatDateTime(report.created_at)
                const status = report.status === 'new' ? 'waiting' : 'complete'

                let line = `[${num}] #${report.id} | от: ${reporter} | на: ${reported} | ${created} | ${status}`

                if (status === 'complete') {
                    const admin = report.resolved_by || '—'
                    const punishment = this.punishmentLabel(report.resolved_action)
                    line += ` | админ: ${admin} | наказание: ${punishment}`
                }

                this.output.write(`${line}\n`)
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
    }

    // Находит репорт по номеру из списка (нумерация сквозная, как в первой вкладке).
    async resolveReportByNumber(number, reports, offset) {
        if (!Number.isInteger(number) || number < 1) {
            return null
        }

        const index = number - offset - 1

        if (index >= 0 && index < reports.length) {
            return reports[index]
        }

        const rows = await this.reportService.getReportsPage(1, number - 1)

        return rows[0] || null
    }

    // Команда read <номер> — отдельный экран репорта: полный текст жалобы и,
    // для решённых, причина наказания. Выход — 0.
    async showReportCard(number, reports, offset) {
        const report = await this.resolveReportByNumber(number, reports, offset)

        if (!report) {
            this.output.write('❌ Нет репорта с таким номером.\n')
            return
        }

        while (true) {
            this.renderReportDetails(report)
            this.output.write('0 — назад к списку репортов\n')

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderReportDetails(report) {
        const border = '='.repeat(40)
        const status = report.status === 'new' ? 'waiting' : 'complete'

        this.output.write(`\n${border}\n`)
        this.output.write(`=== Report #${report.id} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`От: ${this.describeParty(report.reporter_username, report.reporter_chat_id)}\n`)
        this.output.write(`На: ${this.describeParty(report.reported_username, report.reported_chat_id)}\n`)
        this.output.write(`Дата: ${this.formatDateTime(report.created_at)}\n`)
        this.output.write(`Статус: ${status}\n`)
        this.output.write(`\nТекст репорта:\n${report.reason || '—'}\n`)

        if (status === 'complete') {
            this.output.write(`\nАдмин: ${report.resolved_by || '—'}\n`)
            this.output.write(`Наказание: ${this.punishmentLabel(report.resolved_action)}\n`)
            this.output.write(`Причина наказания: ${report.resolved_reason || '—'}\n`)
        }

        this.output.write('\n')
    }

    // Команда send <номер> <ID|.> — принудительно отправить waiting-репорт модератору(ам).
    async sendReportByNumber(account, number, target, reports, offset) {
        const report = await this.resolveReportByNumber(number, reports, offset)

        if (!report) {
            this.output.write('❌ Нет репорта с таким номером.\n')
            return
        }

        if (report.status !== 'new') {
            this.output.write('❌ Репорт уже обработан — отправлять нечего.\n')
            return
        }

        if (!(await this.confirmActionPin(account))) {
            return
        }

        await this.sendReportToModerators(report, target)
    }

    async sendReportToModerators(report, target) {
        if (!this.notifier) {
            this.output.write('❌ Не подключён Telegram-клиент для отправки (notifier).\n')
            return
        }

        let targets

        if (target === '.') {
            targets = await this.activeModeratorChatIDs()
        } else {
            const id = Number(target)

            if (!Number.isInteger(id) || id <= 0) {
                this.output.write('❌ Некорректный ID модератора. Укажите числовой ID или «.».\n')
                return
            }

            targets = [id]
        }

        if (targets.length === 0) {
            this.output.write('❌ Нет модераторов для отправки.\n')
            return
        }

        const text = `🚩 Пользователь ${this.describeParty(report.reporter_username, report.reporter_chat_id)} ` +
            `пожаловался на пользователя ${this.describeParty(report.reported_username, report.reported_chat_id)}.\n\n` +
            `Причина: ${report.reason}`

        let sent = 0
        let failed = 0

        for (const modChatID of targets) {
            try {
                await this.notifier.sendMessage(modChatID, text, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '👁 Посмотреть', callback_data: `report_view_${report.id}` }
                        ]]
                    }
                })
                sent += 1
            } catch (error) {
                failed += 1
                this.output.write(`❌ Не удалось отправить модератору ${modChatID}: ${error.message}\n`)
            }
        }

        this.output.write(`✅ Репорт #${report.id} отправлен. Доставлено: ${sent}${failed ? `, ошибок: ${failed}` : ''}.\n`)
    }

    // ---------------- Вкладка «3. Заблокированные пользователи» ----------------

    // Активные (по сроку) забаненные пользователи, свежие баны сверху.
    async loadBannedUsers() {
        const all = await this.userRepository.findAll()
        const banned = all.filter(user =>
            typeof user.isBannedNow === 'function' ? user.isBannedNow() : Boolean(user.banned)
        )

        banned.sort((a, b) => {
            const at = a.bannedAt ? a.bannedAt.getTime() : 0
            const bt = b.bannedAt ? b.bannedAt.getTime() : 0

            if (bt !== at) {
                return bt - at
            }

            return Number(a.chatID) - Number(b.chatID)
        })

        return banned
    }

    async showBannedList(account) {
        if (!this.userRepository) {
            this.output.write('\n❌ Не подключён репозиторий пользователей (userRepository).\n\n')
            return
        }

        let page = 1

        while (true) {
            const banned = await this.loadBannedUsers()
            const total = banned.length
            const totalPages = Math.max(1, Math.ceil(total / this.BANNED_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.BANNED_PER_PAGE
            const pageItems = banned.slice(offset, offset + this.BANNED_PER_PAGE)

            this.renderBannedPage(account, page, totalPages, total, pageItems, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                continue
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

            const parsed = this.parseBannedAction(input)

            if (!parsed) {
                this.output.write('❌ Неверная команда.\n')
                continue
            }

            const target = banned[parsed.number - 1]

            if (!target) {
                this.output.write('❌ Нет пользователя с таким номером.\n')
                continue
            }

            if (parsed.command === 'read') {
                await this.showBanCard(target)
                continue
            }

            if (!this.moderationActions) {
                this.output.write('❌ Не подключён сервис модерации (moderationActions).\n')
                continue
            }

            await this.executeBannedAction(account, target, parsed)
        }
    }

    renderBannedPage(account, page, totalPages, total, users, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Banned ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (users.length === 0) {
            this.output.write('Нет заблокированных пользователей.\n\n')
        } else {
            users.forEach((user, index) => {
                const num = offset + index + 1
                const id = user.chatID ?? '—'
                const username = user.username ? `@${user.username}` : 'без username'
                const bannedAt = this.formatDateTime(user.bannedAt)
                const by = user.bannedBy || '—'
                const until = user.bannedUntil
                    ? `до ${this.formatDateTime(user.bannedUntil)}`
                    : 'бессрочно'

                this.output.write(`[${num}] ${id} | ${username} | ${bannedAt} | ${by} | ${until}\n`)
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
    }

    // Команда read — карточка блокировки с причиной. Выход — 0.
    async showBanCard(target) {
        while (true) {
            this.renderBanDetails(target)
            this.output.write('0 — назад к списку забаненных\n')

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderBanDetails(user) {
        const border = '='.repeat(40)
        const username = user.username ? `@${user.username}` : 'без username'
        const until = user.bannedUntil
            ? `до ${this.formatDateTime(user.bannedUntil)}`
            : 'бессрочно'

        this.output.write(`\n${border}\n`)
        this.output.write(`=== Блокировка: ${user.chatID} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`Telegram ID: ${user.chatID}\n`)
        this.output.write(`username: ${username}\n`)
        this.output.write(`Дата блокировки: ${this.formatDateTime(user.bannedAt)}\n`)
        this.output.write(`Кто заблокировал: ${user.bannedBy || '—'}\n`)
        this.output.write(`Срок: ${until}\n`)
        this.output.write(`Причина: ${user.banReason || '—'}\n`)
        this.output.write('\n')
    }

    // Разбирает команды вкладки банов: read 1 | pardon 1 ["комментарий"] |
    // permanent 1 | add 1 30d.
    parseBannedAction(input) {
        const text = String(input).trim()

        const read = text.match(/^read\s+(\d+)$/i)

        if (read) {
            return { command: 'read', number: parseInt(read[1], 10) }
        }

        const permanent = text.match(/^permanent\s+(\d+)$/i)

        if (permanent) {
            return { command: 'permanent', number: parseInt(permanent[1], 10) }
        }

        const add = text.match(/^add\s+(\d+)\s+(\d+[mhdy])$/i)

        if (add) {
            return { command: 'add', number: parseInt(add[1], 10), durationText: add[2].toLowerCase() }
        }

        const pardon = text.match(/^pardon\s+(\d+)\s*(.*)$/i)

        if (pardon) {
            let note = pardon[2].trim()
            const quoted = note.match(/^"([\s\S]*)"$/)

            if (quoted) {
                note = quoted[1]
            }

            return { command: 'pardon', number: parseInt(pardon[1], 10), note: note || null }
        }

        return null
    }

    async executeBannedAction(account, target, parsed) {
        const actor = { name: account.name, telegramID: account.telegramID }
        const label = target.chatID

        if (!(await this.confirmActionPin(account))) {
            return
        }

        if (parsed.command === 'pardon') {
            const result = await this.moderationActions.pardon(target, { note: parsed.note, actor })

            this.output.write(result.ok
                ? `✅ Пользователь ${label} разбанен.\n`
                : `❌ ${result.error}\n`)
            return
        }

        if (parsed.command === 'permanent') {
            const result = await this.moderationActions.permanent(target, { actor })

            this.output.write(result.ok
                ? `✅ Пользователь ${label} забанен бессрочно.\n`
                : `❌ ${result.error}\n`)
            return
        }

        if (parsed.command === 'add') {
            const result = await this.moderationActions.extend(target, { durationText: parsed.durationText, actor })

            if (result.ok) {
                this.output.write(`✅ Пользователь ${label}: срок продлён на ${result.human}.\n`)
                this.output.write(`Новая дата окончания: ${this.formatDateTime(result.bannedUntil)}\n`)
            } else {
                this.output.write(`❌ ${result.error}\n`)
            }
        }
    }

    // ---------------- Вкладка «4. История администрирования» ----------------

    async showHistoryList(account) {
        if (!this.moderationActionRepository) {
            this.output.write('\n❌ Не подключён журнал действий (moderationActionRepository).\n\n')
            return
        }

        let page = 1

        while (true) {
            const total = await this.moderationActionRepository.countAll()
            const totalPages = Math.max(1, Math.ceil(total / this.HISTORY_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.HISTORY_PER_PAGE
            const entries = await this.moderationActionRepository.getPage({
                limit: this.HISTORY_PER_PAGE,
                offset
            })

            this.renderHistoryPage(account, page, totalPages, total, entries, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                continue
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

            const readMatch = input.match(/^read\s+(\d+)$/i)

            if (readMatch) {
                await this.showHistoryCard(Number(readMatch[1]), entries, offset)
                continue
            }

            this.output.write('❌ Неверная команда.\n')
        }
    }

    renderHistoryPage(account, page, totalPages, total, entries, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | History ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (entries.length === 0) {
            this.output.write('История пуста.\n\n')
        } else {
            entries.forEach((entry, index) => {
                const num = offset + index + 1
                const when = this.formatDateTime(entry.created_at)
                const admin = entry.moderator_name || '—'
                const action = this.historyActionLabel(entry.action)
                const target = this.historyTargetLabel(entry)

                this.output.write(`[${num}] ${when} | ${admin} | ${action} | ${target}\n`)
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
    }

    // Находит запись истории по номеру (нумерация сквозная, как в других вкладках).
    async resolveHistoryByNumber(number, entries, offset) {
        if (!Number.isInteger(number) || number < 1) {
            return null
        }

        const index = number - offset - 1

        if (index >= 0 && index < entries.length) {
            return entries[index]
        }

        const rows = await this.moderationActionRepository.getPage({ limit: 1, offset: number - 1 })

        return rows[0] || null
    }

    // Команда read <номер> — подробности записи (срок, причина, комментарий). Выход — 0.
    async showHistoryCard(number, entries, offset) {
        const entry = await this.resolveHistoryByNumber(number, entries, offset)

        if (!entry) {
            this.output.write('❌ Нет записи с таким номером.\n')
            return
        }

        while (true) {
            this.renderHistoryDetails(entry)
            this.output.write('0 — назад к истории\n')

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderHistoryDetails(entry) {
        const border = '='.repeat(40)
        const adminID = entry.moderator_telegram_id ? ` (${entry.moderator_telegram_id})` : ''

        this.output.write(`\n${border}\n`)
        this.output.write(`=== История #${entry.id} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`Дата и время: ${this.formatDateTime(entry.created_at)}\n`)
        this.output.write(`Админ: ${entry.moderator_name || '—'}${adminID}\n`)
        this.output.write(`Действие: ${this.historyActionLabel(entry.action)}\n`)
        this.output.write(`Цель: ${this.historyTargetLabel(entry)}\n`)

        if (entry.duration_ms) {
            this.output.write(`Срок: ${this.humanDuration(entry.duration_ms)}\n`)
        }

        this.output.write(`Причина: ${entry.reason || '—'}\n`)
        this.output.write(`Комментарий: ${entry.note || '—'}\n`)
        this.output.write('\n')
    }

    // Цель действия: «@username (chat_id)» либо только chat_id.
    historyTargetLabel(entry) {
        const id = entry.target_chat_id ?? '—'

        return entry.target_username ? `@${entry.target_username} (${id})` : String(id)
    }

    // Код действия из moderation_actions → понятная подпись.
    historyActionLabel(action) {
        if (action === 'ban') {
            return 'бан'
        }

        if (action === 'warn') {
            return 'предупреждение'
        }

        if (action === 'pardon') {
            return 'разбан'
        }

        if (action === 'permanent') {
            return 'бессрочный бан'
        }

        if (action === 'extend') {
            return 'продление срока'
        }

        return action || '—'
    }

    // Длительность в мс → «30 мин» / «5 ч» / «30 дн».
    humanDuration(ms) {
        const value = Number(ms)

        if (!Number.isFinite(value) || value <= 0) {
            return '—'
        }

        const minutes = Math.round(value / 60000)

        if (minutes < 60) {
            return `${minutes} мин`
        }

        const hours = Math.round(value / 3600000)

        if (hours < 24) {
            return `${hours} ч`
        }

        return `${Math.round(value / 86400000)} дн`
    }

    // ---------------- Вкладка «5. Модераторы» ----------------

    // Список модераторов: встроенные из MODERATORSID + записи из БД (активные/снятые).
    async loadModeratorEntries() {
        const rows = await this.moderatorService.listModerators()
        const byID = new Map()

        for (const row of rows) {
            const id = Number(row.chat_id)

            if (!Number.isInteger(id)) {
                continue
            }

            byID.set(id, {
                chatID: id,
                username: row.username || null,
                status: row.active ? 'active' : 'removed',
                source: 'db',
                addedBy: row.added_by || null,
                createdAt: row.created_at || null,
                removedAt: row.removed_at || null,
                hasPins: Boolean(row.pin1 || row.pin2)
            })
        }

        const entries = []

        // Встроенные модераторы, которых нет в БД (личных ключей нет — общие из .env)
        for (const envID of this.moderatorChatIDs) {
            if (!byID.has(envID)) {
                entries.push({
                    chatID: envID,
                    username: null,
                    status: 'active',
                    source: 'env',
                    addedBy: null,
                    createdAt: null,
                    removedAt: null,
                    hasPins: false
                })
            }
        }

        for (const entry of byID.values()) {
            entries.push(entry)
        }

        // Активные — вперёд, затем свежие сверху
        entries.sort((a, b) => {
            if (a.status !== b.status) {
                return a.status === 'active' ? -1 : 1
            }

            const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0

            if (bt !== at) {
                return bt - at
            }

            return a.chatID - b.chatID
        })

        return entries
    }

    // Активные получатели жалоб: MODERATORSID + активные из БД.
    async activeModeratorChatIDs() {
        if (!this.moderatorService) {
            return this.moderatorChatIDs
        }

        const entries = await this.loadModeratorEntries()

        return entries.filter(entry => entry.status === 'active').map(entry => entry.chatID)
    }

    async showModeratorsList(account) {
        if (!this.moderatorService) {
            this.output.write('\n❌ Не подключён сервис модераторов (moderatorService).\n\n')
            return
        }

        let page = 1

        while (true) {
            const entries = await this.loadModeratorEntries()
            const total = entries.length
            const totalPages = Math.max(1, Math.ceil(total / this.MODERATORS_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.MODERATORS_PER_PAGE
            const pageItems = entries.slice(offset, offset + this.MODERATORS_PER_PAGE)
            const pendingInvites = await this.moderatorService.listPendingInvites()

            this.renderModeratorsPage(account, page, totalPages, total, pageItems, offset, pendingInvites)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                continue
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

            const inviteMatch = input.match(/^invite\s+(-?\d+)$/i)

            if (inviteMatch) {
                await this.inviteModerator(account, parseInt(inviteMatch[1], 10), entries)
                continue
            }

            const readMatch = input.match(/^read\s+(\d+)$/i)

            if (readMatch) {
                const target = entries[parseInt(readMatch[1], 10) - 1]

                if (!target) {
                    this.output.write('❌ Нет модератора с таким номером.\n')
                    continue
                }

                await this.showModeratorCard(target)
                continue
            }

            const removeMatch = input.match(/^remove\s+(\d+)$/i)

            if (removeMatch) {
                const value = parseInt(removeMatch[1], 10)
                // Сначала пробуем как chat_id, иначе — как номер строки списка
                const target = entries.find(entry => entry.chatID === value) || entries[value - 1]

                if (!target) {
                    this.output.write('❌ Нет модератора с таким номером/chat_id.\n')
                    continue
                }

                await this.removeModerator(account, target)
                continue
            }

            this.output.write('❌ Неверная команда.\n')
        }
    }

    renderModeratorsPage(account, page, totalPages, total, entries, offset, pendingInvites) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Moderators ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (entries.length === 0) {
            this.output.write('Список модераторов пуст.\n\n')
        } else {
            entries.forEach((entry, index) => {
                const num = offset + index + 1
                const username = entry.username ? `@${entry.username}` : 'без username'
                const status = entry.status === 'active' ? 'активен' : 'снят'
                const source = entry.source === 'env' ? 'MODERATORSID' : 'панель'
                const added = entry.createdAt ? this.formatDateTime(entry.createdAt) : '—'
                const by = entry.addedBy || '—'

                this.output.write(
                    `[${num}] ${entry.chatID} | ${username} | ${status} | источник: ${source} | добавил: ${by} | ${added}\n`
                )
            })
        }

        if (pendingInvites && pendingInvites.length > 0) {
            this.output.write('\nОжидают ответа на приглашение:\n')

            for (const invite of pendingInvites) {
                this.output.write(
                    `   ${invite.chat_id} | код ${invite.invite_code} | пригласил: ${invite.invited_by || '—'} | ${this.formatDateTime(invite.created_at)}\n`
                )
            }
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
    }

    // Команда invite — приглашение в модераторы. Код печатается здесь и передаётся
    // пользователю; сообщение с кнопками шлёт тот же клиент, что и уведомления.
    async inviteModerator(account, chatID, entries) {
        if (!Number.isInteger(chatID) || chatID <= 0) {
            this.output.write('❌ Некорректный chat_id.\n')
            return
        }

        const existing = entries.find(entry => entry.chatID === chatID)

        if (existing && existing.status === 'active') {
            this.output.write(`❌ Пользователь ${chatID} уже модератор.\n`)
            return
        }

        if (!(await this.confirmActionPin(account))) {
            return
        }

        const code = await this.moderatorService.createInvite(chatID, account.name)

        this.output.write(`✅ Приглашение создано для ${chatID}.\nКод (передайте пользователю): ${code}\n`)

        if (!this.notifier) {
            this.output.write('⚠️  Telegram-клиент недоступен — приглашение сохранено, но сообщение не отправлено.\n')
            return
        }

        const text = '🔔 Вас пригласили стать модератором IdeologyDatingBot.\n\n' +
            'Если вы согласны, нажмите «✅ Принять» и введите 4-значный код, который передал администратор.'

        try {
            await this.notifier.sendMessage(chatID, text, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Принять', callback_data: 'mod_invite_accept' },
                        { text: '❌ Отказаться', callback_data: 'mod_invite_decline' }
                    ]]
                }
            })
            this.output.write('📨 Приглашение отправлено в Telegram.\n')
        } catch (error) {
            this.output.write(`❌ Не удалось отправить приглашение: ${error.message}\n`)
            this.output.write('ℹ️  Пользователь должен хотя бы раз запустить бота (/start).\n')
        }
    }

    async removeModerator(account, target) {
        if (target.status === 'removed') {
            this.output.write(`ℹ️  Модератор ${target.chatID} уже снят.\n`)
            return
        }

        if (!(await this.confirmActionPin(account))) {
            return
        }

        await this.moderatorService.removeModerator(target.chatID)
        this.output.write(`✅ Пользователь ${target.chatID} лишён прав модератора.\n`)
    }

    async showModeratorCard(entry) {
        while (true) {
            this.renderModeratorDetails(entry)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderModeratorDetails(entry) {
        const border = '='.repeat(40)

        this.output.write(`\n${border}\n`)
        this.output.write(`=== Модератор ${entry.chatID} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`chat_id: ${entry.chatID}\n`)
        this.output.write(`username: ${entry.username ? `@${entry.username}` : '—'}\n`)
        this.output.write(`Статус: ${entry.status === 'active' ? 'активен' : 'снят'}\n`)
        this.output.write(`Источник: ${entry.source === 'env' ? 'MODERATORSID (встроенный)' : 'панель администрирования'}\n`)
        this.output.write(`Добавил: ${entry.addedBy || '—'}\n`)
        this.output.write(`Добавлен: ${this.formatDateTime(entry.createdAt)}\n`)

        if (entry.removedAt) {
            this.output.write(`Снят: ${this.formatDateTime(entry.removedAt)}\n`)
        }

        this.output.write(`Личные admin-ключи: ${entry.hasPins ? 'установлены' : 'нет (общие из .env)'}\n`)
        this.output.write('\n')
    }

    // ── История разработки ────────────────────────────────────────────────────

    async showDevHistoryList(account) {
        if (!this.devHistoryService) {
            this.output.write('\n❌ Не подключён сервис истории разработки (devHistoryService).\n\n')
            return
        }

        const loaded = this.devHistoryService.list()

        if (!loaded.success) {
            this.output.write(`\n❌ ${loaded.message}\n\n`)
            return
        }

        let entries = loaded.entries
        let page = 1

        while (true) {
            const total = entries.length
            const totalPages = Math.max(1, Math.ceil(total / this.DEV_HISTORY_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.DEV_HISTORY_PER_PAGE
            const slice = entries.slice(offset, offset + this.DEV_HISTORY_PER_PAGE)

            this.renderDevHistoryPage(account, page, totalPages, total, slice, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                const refreshed = this.devHistoryService.list()

                if (refreshed.success) {
                    entries = refreshed.entries
                }

                continue
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

            const readMatch = input.match(/^read\s+(\d+)$/i)

            if (readMatch) {
                await this.showDevHistoryCard(Number(readMatch[1]), entries, offset)
                continue
            }

            this.output.write('❌ Неверная команда. Доступно: read N | < | > | update | 0.\n')
        }
    }

    renderDevHistoryPage(account, page, totalPages, total, entries, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Dev History ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (entries.length === 0) {
            this.output.write('Записей пока нет.\n\n')
        } else {
            entries.forEach((entry, index) => {
                const num = offset + index + 1
                const date = this.formatDateTime(entry.date)

                this.output.write(`[${num}] ${entry.hash} | ${date} | ${entry.subject}\n`)
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
        this.output.write('read N — открыть запись | update — обновить историю\n')
    }

    devHistoryKindLabel(kind) {
        if (kind === 'version') {
            return 'Версия'
        }

        if (kind === 'commit') {
            return 'Коммит'
        }

        return 'Запись'
    }

    resolveDevHistoryByNumber(number, entries, offset) {
        if (!Number.isInteger(number) || number < 1) {
            return null
        }

        const index = number - offset - 1

        if (index >= 0 && index < entries.length) {
            return entries[index]
        }

        return entries[number - 1] || null
    }

    // read N — открыть запись: полное описание коммита.
    async showDevHistoryCard(number, entries, offset) {
        const entry = this.resolveDevHistoryByNumber(number, entries, offset)

        if (!entry) {
            this.output.write('❌ Нет записи с таким номером.\n')
            return
        }

        while (true) {
            this.renderDevHistoryDetails(entry)
            this.output.write('0 — назад к истории разработки\n')

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderDevHistoryDetails(entry) {
        const border = '='.repeat(40)

        this.output.write(`\n${border}\n`)
        this.output.write(`=== Запись разработки #${entry.number} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`Тип: ${this.devHistoryKindLabel(entry.kind)}\n`)
        this.output.write(`Хэш: ${entry.hash}\n`)
        this.output.write(`Автор: ${entry.author || '—'}\n`)
        this.output.write(`Дата: ${this.formatDateTime(entry.date)}\n`)
        this.output.write(`\nОписание:\n${entry.subject || '—'}\n`)

        if (entry.body) {
            this.output.write(`\n${entry.body}\n`)
        }

        this.output.write('\n')
    }

    // ── Тикеты (обращения в поддержку) ────────────────────────────────────────

    async showTicketsList(account) {
        if (!this.supportTicketService) {
            this.output.write('\n❌ Не подключён сервис тикетов (supportTicketService).\n\n')
            return
        }

        let page = 1

        while (true) {
            const total = await this.supportTicketService.getTicketsCount()
            const totalPages = Math.max(1, Math.ceil(total / this.TICKETS_PER_PAGE))

            if (page > totalPages) {
                page = totalPages
            }

            if (page < 1) {
                page = 1
            }

            const offset = (page - 1) * this.TICKETS_PER_PAGE
            const tickets = await this.supportTicketService.getTicketsPage(this.TICKETS_PER_PAGE, offset)

            this.renderTicketsPage(account, page, totalPages, total, tickets, offset)

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            if (input.toLowerCase() === 'update') {
                continue
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

            const parsed = this.parseTicketCommand(input)

            if (!parsed) {
                this.output.write('❌ Неверная команда. Доступно: read N | reply N "текст" | < | > | 0.\n')
                continue
            }

            if (parsed.command === 'read') {
                await this.showTicketCard(account, parsed.number, tickets, offset)
                continue
            }

            await this.replyTicket(account, parsed.number, parsed.text, tickets, offset)
        }
    }

    renderTicketsPage(account, page, totalPages, total, tickets, offset) {
        const border = '='.repeat(40)
        this.output.write(`\n${border}\n`)
        this.output.write('=== IdeologyDatingBot | Tickets ===\n')
        this.output.write(`${border}\n`)
        this.output.write(`Админ: ${account.name}\n`)
        this.output.write(`Страница: ${page}/${totalPages} | Всего: ${total}\n\n`)

        if (tickets.length === 0) {
            this.output.write('Обращений пока нет.\n\n')
        } else {
            tickets.forEach((ticket, index) => {
                const num = offset + index + 1
                const created = this.formatDateTime(ticket.created_at)
                const author = this.describeParty(ticket.username, ticket.user_chat_id)
                const type = this.ticketTypeLabel(ticket.type)
                const status = this.ticketStatusLabel(ticket)

                this.output.write(`[${num}] ${created} | ${author} | ${type} | ${status}\n`)
            })
        }

        this.output.write('\nНавигация:\n')
        this.output.write('<  — предыдущая страница | >  — следующая страница | 0 — главное меню\n')
        this.output.write('read N — открыть обращение | reply N "текст" — ответить пользователю\n')
    }

    ticketTypeLabel(type) {
        if (type === 'bug') {
            return 'Баг'
        }

        if (type === 'idea') {
            return 'Предложение'
        }

        return '—'
    }

    ticketStatusLabel(ticket) {
        if (ticket.replied_at) {
            return 'отвечен'
        }

        if (ticket.read_at) {
            return 'прочитан'
        }

        return 'новый'
    }

    // Находит тикет по сквозному номеру из списка (нумерация как в других вкладках).
    async resolveTicketByNumber(number, tickets, offset) {
        if (!Number.isInteger(number) || number < 1) {
            return null
        }

        const index = number - offset - 1

        if (index >= 0 && index < tickets.length) {
            return tickets[index]
        }

        const rows = await this.supportTicketService.getTicketsPage(1, number - 1)

        return rows[0] || null
    }

    // read N — открыть обращение; прочтение засчитывается за этим админом.
    async showTicketCard(account, number, tickets, offset) {
        const ticket = await this.resolveTicketByNumber(number, tickets, offset)

        if (!ticket) {
            this.output.write('❌ Нет обращения с таким номером.\n')
            return
        }

        let current = ticket

        if (!ticket.read_at) {
            const marked = await this.supportTicketService.markRead(ticket.id, account.name)

            if (marked.success && marked.ticket) {
                current = marked.ticket
            }
        }

        while (true) {
            this.renderTicketDetails(current)
            this.output.write('0 — назад к списку обращений\n')

            const input = (await this.ask('\nВведите команду: ')).trim()

            if (input === '0') {
                return
            }

            this.output.write('❌ Неверная команда. Доступно: 0 — назад.\n')
        }
    }

    renderTicketDetails(ticket) {
        const border = '='.repeat(40)

        this.output.write(`\n${border}\n`)
        this.output.write(`=== Тикет #${ticket.id} ===\n`)
        this.output.write(`${border}\n`)
        this.output.write(`От: ${this.describeParty(ticket.username, ticket.user_chat_id)}\n`)
        this.output.write(`Тип: ${this.ticketTypeLabel(ticket.type)}\n`)
        this.output.write(`Дата: ${this.formatDateTime(ticket.created_at)}\n`)
        this.output.write(`Статус: ${this.ticketStatusLabel(ticket)}\n`)

        if (ticket.read_by) {
            this.output.write(`Прочитал: ${ticket.read_by} (${this.formatDateTime(ticket.read_at)})\n`)
        }

        this.output.write(`\nТекст обращения:\n${ticket.message || '—'}\n`)

        if (ticket.replied_at) {
            this.output.write(`\nОтвет: ${ticket.reply_text || '—'}\n`)
            this.output.write(`Ответил: ${ticket.replied_by || '—'} (${this.formatDateTime(ticket.replied_at)})\n`)
        }

        this.output.write('\n')
    }

    // reply N "текст" — отправить пользователю ответ на обращение.
    async replyTicket(account, number, text, tickets, offset) {
        const ticket = await this.resolveTicketByNumber(number, tickets, offset)

        if (!ticket) {
            this.output.write('❌ Нет обращения с таким номером.\n')
            return
        }

        const replyText = String(text ?? '').trim()

        if (!replyText) {
            this.output.write('❌ Текст ответа не может быть пустым.\n')
            return
        }

        if (!(await this.confirmActionPin(account))) {
            return
        }

        if (!this.notifier) {
            this.output.write('❌ Не подключён Telegram-клиент для отправки (notifier).\n')
            return
        }

        const message = `📩 На ваше обращение был получен ответ!\n\n${replyText}`

        try {
            await this.notifier.sendMessage(ticket.user_chat_id, message)
        } catch (error) {
            this.output.write(`❌ Не удалось отправить ответ: ${error.message}\n`)
            this.output.write('ℹ️  Пользователь должен хотя бы раз запустить бота (/start).\n')
            return
        }

        const saved = await this.supportTicketService.reply(ticket.id, replyText, account.name)

        if (!saved.success) {
            this.output.write(`⚠️  Ответ отправлен, но не сохранён в базе: ${saved.message || 'ошибка'}\n`)
            return
        }

        this.output.write(`✅ Ответ отправлен пользователю ${ticket.user_chat_id}.\n`)
    }

    // Разбирает команды тикетов: read 1 | reply 1 "текст ответа".
    parseTicketCommand(input) {
        const readMatch = input.match(/^read\s+(\d+)$/i)

        if (readMatch) {
            return { command: 'read', number: Number(readMatch[1]) }
        }

        const replyMatch = input.match(/^reply\s+(\d+)\s+([\s\S]+)$/i)

        if (!replyMatch) {
            return null
        }

        const rest = replyMatch[2].trim()
        const quoted = rest.match(/^"([\s\S]*)"$/)
        const text = quoted ? quoted[1].trim() : rest

        return { command: 'reply', number: Number(replyMatch[1]), text }
    }

    // «@username (chat_id)» либо «без username (chat_id)».
    describeParty(username, chatID) {
        const id = chatID ?? '—'
        return username ? `@${username} (${id})` : `без username (${id})`
    }

    // Наказание по коду действия из reports.resolved_action.
    punishmentLabel(action) {
        if (action === 'ban') {
            return 'бан'
        }

        if (action === 'warn') {
            return 'предупреждение'
        }

        if (action === 'dismiss') {
            return 'отклонена'
        }

        return '—'
    }

    // Дата и время: DD.MM.YYYY HH:MM.
    formatDateTime(date) {
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
        const hours = String(d.getHours()).padStart(2, '0')
        const minutes = String(d.getMinutes()).padStart(2, '0')

        return `${day}.${month}.${year} ${hours}:${minutes}`
    }

    // Разбирает команду вида: ban 1 24h "причина" | warn 1 "причина" | pardon 1 "комментарий"
    parseAction(input) {
        const match = String(input).trim().match(/^(ban|warn|pardon)\s+(\d+)\s*(.*)$/i)

        if (!match) {
            return null
        }

        const command = match[1].toLowerCase()

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

        if (!(await this.confirmActionPin(account))) {
            return
        }

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

        if (command === 'warn') {
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
