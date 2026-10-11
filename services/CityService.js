// Приводит название города к единому ключу, чтобы «Казань», «Kazan»
// и «K@zan» распознавались как один и тот же город.
class CityService {
    constructor() {
        // Вариант «искать по всему миру» вместо конкретного города.
        this.globalLabel = '🌍 Глобал'
        this.globalCity = 'Глобал'

        // Эти названия нельзя занимать под город — они зарезервированы
        // под «глобальный» режим.
        this.reservedCityPrefixes = ['global', 'globe', 'world', 'planet', 'vsemirn']

        this.cyrillicToLatin = {
            а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
            ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
            н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
            ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
            ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
        }

        // Замены в стиле leet, чтобы «K@zan» читалось как «Kazan».
        this.leet = {
            '@': 'a', '$': 's', 0: 'o', 3: 'e', 4: 'a', 5: 's', 7: 't'
        }

        // Эквивалентные названия одного города, которые не сводятся
        // друг к другу простой транслитерацией (экзонимы и т.п.).
        // Ключи и значения уже в нормализованном виде.
        this.aliases = {
            moscow: 'moskva',
            piter: 'sanktpeterburg',
            spb: 'sanktpeterburg',
            stpetersburg: 'sanktpeterburg',
            saintpetersburg: 'sanktpeterburg',
            yekaterinburg: 'ekaterinburg',
            jaroslavl: 'yaroslavl',
            nizhnynovgorod: 'nizhniynovgorod',
            rostovondon: 'rostovnadonu'
        }
    }

    normalize(city) {
        if (!city) {
            return ''
        }

        let value = String(city).trim().toLowerCase()

        value = value.replace(/[@$03457]/g, char => this.leet[char])
        value = value.replace(/[а-яё]/g, char => this.cyrillicToLatin[char] ?? '')
        value = value.replace(/[^a-z]/g, '')

        return value
    }

    getKey(city) {
        const normalized = this.normalize(city)

        if (!normalized) {
            return ''
        }

        return this.aliases[normalized] || normalized
    }

    isReserved(city) {
        const key = this.normalize(city)

        if (!key) {
            return false
        }

        return this.reservedCityPrefixes.some(prefix => key.startsWith(prefix))
    }

    isValid(city) {
        if (!city) {
            return false
        }

        const raw = String(city).trim().toLowerCase()

        // В названии города должна быть хотя бы одна буква,
        // чтобы «12345» или «!!!» не считались городом.
        if (!/[a-zа-яё]/.test(raw)) {
            return false
        }

        return this.normalize(city).length >= 2
    }
}

module.exports = CityService
