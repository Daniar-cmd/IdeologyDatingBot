class LikeService {
    constructor(users) {
        this.users = users
    }

    sendLike(fromChatID, toChatID) {
        const fromID = Number(fromChatID)
        const toID = Number(toChatID)

        const fromUser = this.users[fromID]
        const toUser = this.users[toID]

        if (!fromUser || !toUser) {
            return {
                success: false,
                message: 'Пользователь не найден.'
            }
        }

        if (fromID === toID) {
            return {
                success: false,
                message: 'Нельзя поставить лайк самому себе.'
            }
        }

        const alreadyLiked = fromUser.hasLiked(toID)

        fromUser.addLike(toID)
        fromUser.addViewed(toID)
        toUser.addIncomingLike(fromID)

        return {
            success: true,
            alreadyLiked,
            isMatch: toUser.hasLiked(fromID)
        }
    }

    rejectLike(fromChatID, toChatID) {
        const fromID = Number(fromChatID)
        const toID = Number(toChatID)

        const fromUser = this.users[fromID]
        const toUser = this.users[toID]

        if (!fromUser || !toUser) {
            return false
        }

        fromUser.addViewed(toID)

        return true
    }

    hasIncomingLike(chatID, fromChatID) {
        const user = this.users[Number(chatID)]

        if (!user) {
            return false
        }

        return user.hasIncomingLike(fromChatID)
    }

    createMatch(fromChatID, toChatID) {
        const fromID = Number(fromChatID)
        const toID = Number(toChatID)

        const fromUser = this.users[fromID]
        const toUser = this.users[toID]

        if (!fromUser || !toUser) {
            return {
                success: false,
                message: 'Пользователь не найден.'
            }
        }

        if (!toUser.hasLiked(fromID)) {
            return {
                success: false,
                message: 'Этот лайк уже недействителен.'
            }
        }

        const alreadyMatched = fromUser.hasMatch(toID)

        if (!alreadyMatched) {
            fromUser.addLike(toID)
            fromUser.addMatch(toID)
            toUser.addMatch(fromID)
        }

        return {
            success: true,
            alreadyMatched,
            user: fromUser,
            matchedUser: toUser
        }
    }
}

module.exports = LikeService