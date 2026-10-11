// Простой фильтр недопустимого контента для имени, описания и города.
// Список слов — стартовый и рассчитан на лёгкое расширение.
class ContentFilter {
    constructor() {
        // Корни в нормализованном виде (нижний регистр, «ё» -> «е»).
        // Проверяются как подстрока внутри слова.
        this.blockedRoots = [
            // Мат
            'хуй', 'хуя', 'хую', 'хуе', 'хуи',
            'пизд', 'пезд',
            'бля', 'бляд', 'блят',
            'ебат', 'ебал', 'ебан', 'ебуч', 'ебля', 'ебну', 'ебет', 'еби',
            'ебис', 'ебло', 'ебало', 'выеб', 'заеб', 'наеб', 'уеб',
            'долбоеб', 'долбаеб',
            'сука', 'суки', 'сучк', 'сучон', 'сучар',
            'мудак', 'мудил',
            'гандон', 'гондон',
            'залуп',
            'шлюх', 'шлюш',
            'мраз',
            'пидор', 'пидар', 'педераст',
            'говно', 'говен', 'говнюк', 'говноед',
            'жоп',
            'дроч', 'дрочер',
            'срат',
            // Сексуальное
            'секс', 'сексуал', 'секстинг',
            'порно', 'порн',
            'эрот', 'эротик',
            'оргий', 'оргия', 'оргию',
            'минет', 'миньет',
            'анальн',
            'вагин',
            'пенис',
            'клитор',
            'сиськ', 'сисек',
            'титьк', 'титек',
            'презерватив',
            'вибратор',
            'мастурб',
            'генитал',
            'мошонк',
            'сперм',
            'эякул',
            'феллац', 'фелляц',
            'бдсм',
            // Враждебные/экстремистские
            'гитлер',
            'нацист', 'нацизм', 'нацик',
            'фашист', 'фашизм',
            // Английский
            'fuck', 'fucking', 'fucker',
            'shit', 'bitch', 'cunt', 'dick', 'pussy',
            'whore', 'slut', 'nigger', 'nigga',
            'nazi', 'hitler', 'porn', 'porno', 'sexy'
        ]

        this.linkPattern =
            /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|vk\.com\/|instagram\.com\/|wa\.me\/)/i

        this.domainPattern =
            /\b[a-zа-я0-9-]{2,}\.(com|ru|net|org|io|me|info|biz|site|online|xyz|store|app|dev|рф)\b/i
    }

    normalize(text) {
        if (!text) {
            return ''
        }

        let value = String(text).toLowerCase().replace(/ё/g, 'е')

        value = value
            .replace(/@/g, 'а')
            .replace(/\$/g, 'с')
            .replace(/0/g, 'о')
            .replace(/3/g, 'е')
            .replace(/4/g, 'а')

        // Разделяем слова, оставляя только буквы.
        value = value.replace(/[^a-zа-я]+/g, ' ')

        return value.trim()
    }

    containsBlocked(text) {
        const tokens = this.normalize(text).split(/\s+/).filter(Boolean)

        return tokens.some(token =>
            this.blockedRoots.some(root => token.includes(root))
        )
    }

    containsLink(text) {
        const value = String(text || '')

        return this.linkPattern.test(value) || this.domainPattern.test(value)
    }

    check(text) {
        if (this.containsLink(text)) {
            return { ok: false, reason: 'link' }
        }

        if (this.containsBlocked(text)) {
            return { ok: false, reason: 'word' }
        }

        return { ok: true }
    }
}

module.exports = ContentFilter
