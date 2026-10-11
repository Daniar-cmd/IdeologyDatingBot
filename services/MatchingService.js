class MatchingService {
    constructor(users, cityService) {
        this.users = users
        this.cityService = cityService
    }

    // Глобальные пользователи видят всех и видимы всем.
    // Остальные — только совпадение по городу.
    canSee(user, otherUser) {
        if (user.isGlobal || otherUser.isGlobal) {
            return true
        }

        const userCityKey = this.cityService.getKey(user.city)
        const otherCityKey = this.cityService.getKey(otherUser.city)

        return Boolean(userCityKey) && userCityKey === otherCityKey
    }

    findMatch(chatID) {
        const user = this.users[Number(chatID)]

        if (!user) {
            return null
        }

        const matches = []

        for (const otherChatID in this.users) {
            if (otherChatID === String(chatID)) {
                continue
            }

            const otherUser = this.users[otherChatID]

            if (user.viewed?.includes(Number(otherChatID))) {
                continue
            }
            if (!otherUser?.registered) {
                continue
            }
            if (!otherUser.isProfileComplete()) {
                continue
            }
            if (otherUser.hidden) {
                continue
            }
            if (otherUser.banned) {
                continue
            }
            if (user.gender === otherUser.gender) {
                continue
            }
            if (!this.canSee(user, otherUser)) {
                continue
            }

            matches.push({
                chatID: Number(otherChatID),
                user: otherUser
            })
        }

        if (matches.length === 0) {
            return null
        }

        const randomIndex = Math.floor(Math.random() * matches.length)

        return matches[randomIndex]
    }
}

module.exports = MatchingService
