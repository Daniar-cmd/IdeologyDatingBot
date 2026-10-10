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

        fromUser.addLike(toID)
        fromUser.addViewed(toID)
        toUser.addIncomingLike(fromID)

        return {
            success: true,
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

        fromUser.addLike(toID)

        return {
            success: true,
            user: fromUser,
            matchedUser: toUser
        }
    }
}

module.exports = LikeService