class MatchingService {
constructor(users) {
this.users = users
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
        if (user.gender === otherUser.gender) {
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
    const randomIndex = Math.floor(
        Math.random() * matches.length
    )
    return matches[randomIndex]
}

}

module.exports = MatchingService