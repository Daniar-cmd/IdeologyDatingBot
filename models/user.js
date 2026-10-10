class User {
    constructor({
        chatID,
        username = null,
        registered = false,
        name = null,
        gender = null,
        age = null,
        description = '',
        city = null,
        photos = [],
        likes = [],
        likedBy = [],
        viewed = []
    }) {
        this.chatID = chatID
        this.username = username
        this.registered = registered
        this.name = name
        this.gender = gender
        this.age = age
        this.description = description
        this.city = city

        this.photos = Array.isArray(photos) ? photos : []
        this.likes = Array.isArray(likes) ? likes : []
        this.likedBy = Array.isArray(likedBy) ? likedBy : []
        this.viewed = Array.isArray(viewed) ? viewed : []
    }

    isProfileComplete() {
        return Boolean(
            this.registered &&
            this.name &&
            this.age &&
            this.city &&
            this.photos.length > 0
        )
    }

    hasLiked(chatID) {
        return this.likes.includes(Number(chatID))
    }

    addLike(chatID) {
        const id = Number(chatID)

        if (!this.hasLiked(id)) {
            this.likes.push(id)
        }
    }

    addViewed(chatID) {
        const id = Number(chatID)

        if (!this.viewed.includes(id)) {
            this.viewed.push(id)
        }
    }

    addIncomingLike(chatID) {
        const id = Number(chatID)

        if (!this.likedBy.includes(id)) {
            this.likedBy.push(id)
        }
    }

    hasIncomingLike(chatID) {
        return this.likedBy.includes(Number(chatID))
    }
}

module.exports = User