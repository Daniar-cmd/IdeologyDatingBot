// Бизнес-логика рассылок («Радио»).
//
// В консольной панели сервис используется для разбора команды
// `radio @user [f|m] [город,город|global] [возраст_от|--] [возраст_до]`
// и описания аудитории. В процессе бота — для подбора получателей и отправки.
//
// Аудитория рассылки:
//   - только пользователи с заполненной анкетой;
//   - забаненные исключаются;
//   - gender — пол получателя ('male' | 'female' | null = все);
//   - cities — список городов; рассылка по городу НЕ доходит до «Глобал»;
//   - age_from / age_to — границы возраста (null = без ограничения).
class BroadcastService {
    constructor({ broadcastRepository = null, users = null, cityService = null } = {}) {
        this.broadcastRepository = broadcastRepository
        this.users = users
        this.cityService = cityService

        // Небольшая пауза между пачками сообщений, чтобы не упираться
        // в лимиты Telegram при массовой рассылке.
        this.sendBatchSize = 25
        this.sendBatchPauseMs = 1000
    }

    // ─────────────────────────── Разбор команды ───────────────────────────

    // Возвращает { ok: true, username, gender, cities, isGlobal, ageFrom, ageTo }
    // либо { ok: false, error: 'format' | 'username' | 'age' }.
    parseRadioCommand(input) {
        const text = String(input || '').trim()
        const match = text.match(/^radio\s+([\s\S]+)$/i)

        if (!match) {
            return { ok: false, error: 'format' }
        }

        const tokens = match[1].split(/\s+/).filter(Boolean)

        if (tokens.length === 0) {
            return { ok: false, error: 'format' }
        }

        const first = tokens.shift()

        if (!first.startsWith('@') || first.length < 2) {
            return { ok: false, error: 'username' }
        }

        const username = first.slice(1).replace(/^@+/, '').trim()

        if (!username) {
            return { ok: false, error: 'username' }
        }

        let gender = null
        let isGlobal = false
        const cities = []
        const ages = []

        for (const token of tokens) {
            const low = token.toLowerCase()

            if (low === 'f' || low === 'ж' || low === 'женщины') {
                gender = 'female'
                continue
            }

            if (low === 'm' || low === 'м' || low === 'мужчины') {
                gender = 'male'
                continue
            }

            if (low === 'global' || low === 'глобал') {
                isGlobal = true
                continue
            }

            // Пропуск возраста «от» (чтобы задать только «до»).
            if (token === '--') {
                ages.push(null)
                continue
            }

            if (/^\d{1,3}$/.test(token)) {
                ages.push(Number(token))
                continue
            }

            for (const part of token.split(',')) {
                const value = part.trim()

                if (value) {
                    cities.push(value)
                }
            }
        }

        let ageFrom = null
        let ageTo = null

        if (ages.length === 1) {
            ageFrom = ages[0]
        } else if (ages.length >= 2) {
            ageFrom = ages[0]
            ageTo = ages[1]
        }

        if (ageFrom !== null && (ageFrom < 1 || ageFrom > 120)) {
            return { ok: false, error: 'age' }
        }

        if (ageTo !== null && (ageTo < 1 || ageTo > 120)) {
            return { ok: false, error: 'age' }
        }

        return { ok: true, username, gender, cities, isGlobal, ageFrom, ageTo }
    }

    // ─────────────────────────── Описание аудитории ───────────────────────────

    genderLabel(gender) {
        if (gender === 'female') {
            return 'женщины'
        }

        if (gender === 'male') {
            return 'мужчины'
        }

        return 'все'
    }

    ageLabel(ageFrom, ageTo) {
        const from = ageFrom === null || ageFrom === undefined ? null : Number(ageFrom)
        const to = ageTo === null || ageTo === undefined ? null : Number(ageTo)

        if (from !== null && to !== null) {
            return `${from}–${to}`
        }

        if (from !== null) {
            return `от ${from}`
        }

        if (to !== null) {
            return `до ${to}`
        }

        return ''
    }

    // Список городов из записи рассылки (строка «a,b,c» → ['a','b','c']).
    cityList(broadcast) {
        if (!broadcast || !broadcast.cities) {
            return []
        }

        return String(broadcast.cities)
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    }

    // Человекочитаемое описание аудитории для списка и карточки рассылки.
    describeAudience(broadcast) {
        if (!broadcast) {
            return '—'
        }

        const parts = [this.genderLabel(broadcast.gender)]
        const age = this.ageLabel(broadcast.age_from, broadcast.age_to)

        if (age) {
            parts.push(age)
        }

        const cities = this.cityList(broadcast)

        if (cities.length > 0) {
            parts.push(cities.join(', '))
        } else {
            parts.push('все города')
        }

        return parts.join(' · ')
    }

    // ─────────────────────────── Аудитория и отправка ───────────────────────────

    cityKey(value) {
        if (value === null || value === undefined || value === '') {
            return ''
        }

        if (this.cityService && typeof this.cityService.getKey === 'function') {
            return this.cityService.getKey(value)
        }

        return String(value).trim().toLowerCase()
    }

    matchesAudience(user, broadcast) {
        if (!user || !broadcast) {
            return false
        }

        if (typeof user.isProfileComplete === 'function' && !user.isProfileComplete()) {
            return false
        }

        if (user.banned) {
            return false
        }

        if (broadcast.gender && user.gender !== broadcast.gender) {
            return false
        }

        const cities = this.cityList(broadcast)

        if (cities.length > 0) {
            // Рассылка по городу не доходит до пользователей «Глобал».
            if (user.isGlobal) {
                return false
            }

            const userKey = this.cityKey(user.city)
            const wanted = cities.map(city => this.cityKey(city)).filter(Boolean)

            if (!userKey || !wanted.includes(userKey)) {
                return false
            }
        }

        const from = broadcast.age_from === null || broadcast.age_from === undefined
            ? null
            : Number(broadcast.age_from)
        const to = broadcast.age_to === null || broadcast.age_to === undefined
            ? null
            : Number(broadcast.age_to)

        if (from !== null && (user.age === null || user.age === undefined || Number(user.age) < from)) {
            return false
        }

        if (to !== null && (user.age === null || user.age === undefined || Number(user.age) > to)) {
            return false
        }

        return true
    }

    // Получатели рассылки среди загруженных анкет.
    selectAudience(broadcast) {
        if (!this.users) {
            return []
        }

        return Object.values(this.users).filter(user => this.matchesAudience(user, broadcast))
    }

    // Отправляет контент одному получателю: фото с подписью либо текст.
    // Длинная подпись (>1024) уходит отдельным сообщением после фото.
    async sendContent(bot, chatID, text, photoFileID) {
        const value = text === null || text === undefined ? '' : String(text)

        if (photoFileID) {
            if (value.length <= 1024) {
                const options = value ? { caption: value } : {}
                await bot.sendPhoto(chatID, photoFileID, options)
            } else {
                await bot.sendPhoto(chatID, photoFileID)

                if (value) {
                    await bot.sendMessage(chatID, value)
                }
            }

            return
        }

        if (value) {
            await bot.sendMessage(chatID, value)
        }
    }

    // Рассылает контент всем подходящим пользователям. Возвращает итоги.
    async sendToAudience(bot, broadcast, { onProgress = null } = {}) {
        const recipients = this.selectAudience(broadcast)
        const total = recipients.length

        let sent = 0
        let failed = 0
        let processed = 0

        for (const user of recipients) {
            try {
                await this.sendContent(bot, user.chatID, broadcast.content_text, broadcast.photo_file_id)
                sent += 1
            } catch (error) {
                failed += 1
            }

            processed += 1

            if (processed % this.sendBatchSize === 0) {
                await new Promise(resolve => setTimeout(resolve, this.sendBatchPauseMs))
            }

            if (typeof onProgress === 'function') {
                onProgress({ total, sent, failed })
            }
        }

        return { total, sent, failed }
    }
}

module.exports = BroadcastService
