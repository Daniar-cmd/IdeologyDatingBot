class ProfileService {
constructor(users) {
this.users = users
}

getProfile(chatID) {
    return this.users[Number(chatID)] || null
}
isProfileComplete(chatID) {
    const user = this.getProfile(chatID)
    return Boolean(user && user.isProfileComplete())
}
getProfileForDating(chatID, otherChatID) {
    const currentUser = this.getProfile(chatID)
    const otherUser = this.getProfile(otherChatID)
    if (!currentUser || !otherUser) {
        return null
    }
    if (!otherUser.registered || !otherUser.isProfileComplete()) {
        return null
    }
    if (otherUser.banned) {
        return null
    }
    if (Number(chatID) === Number(otherChatID)) {
        return null
    }
    return otherUser
}

hideFromSearch(chatID) {
    const user = this.getProfile(chatID)
    if (!user) {
        return { success: false }
    }
    if (user.hidden) {
        return {
            success: false,
            message: 'Анкета уже скрыта из поиска.'
        }
    }
    user.hidden = true
    return {
        success: true,
        user
    }
}

returnToSearch(chatID) {
    const user = this.getProfile(chatID)
    if (!user) {
        return { success: false }
    }
    if (!user.hidden) {
        return {
            success: false,
            message: 'Анкета уже в поиске.'
        }
    }
    user.hidden = false
    return {
        success: true,
        user
    }
}

}

module.exports = ProfileService