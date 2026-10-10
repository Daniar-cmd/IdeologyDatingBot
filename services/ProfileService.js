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
    if (Number(chatID) === Number(otherChatID)) {
        return null
    }
    return otherUser
}

}

module.exports = ProfileService