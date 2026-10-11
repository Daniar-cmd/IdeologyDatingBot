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
        isGlobal = false,
        photos = [],
        likes = [],
        likedBy = [],
        viewed = [],
        matches = [],
        hidden = false,
        banned = false,
        warnings = 0
    }) {
        this.chatID = chatID
        this.username = username
        this.registered = registered
        this.name = name
        this.gender = gender
        this.age = age
        this.description = description
        this.city = city
        this.isGlobal = Boolean(isGlobal)
        this.hidden = Boolean(hidden)
        this.banned = Boolean(banned)
        this.warnings = Number(warnings) || 0

        this.photos = Array.isArray(photos) ? photos : []
        this.likes = Array.isArray(likes) ? likes : []
        this.likedBy = Array.isArray(likedBy) ? likedBy : []
        this.viewed = Array.isArray(viewed) ? viewed : []
        this.matches = Array.isArray(matches) ? matches : []
    }

    isProfileComplete() {
        return Boolean(
            this.registered &&
            this.name &&
            this.age &&
            (this.city || this.isGlobal) &&
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

    hasMatch(chatID) {
        return this.matches.includes(Number(chatID))
    }

    addMatch(chatID) {
        const id = Number(chatID)

        if (!this.hasMatch(id)) {
            this.matches.push(id)
        }
    }

    applyBan() {
        this.banned = true

        return { banned: true }
    }

    applyWarning() {
        this.warnings = Number(this.warnings) + 1

        if (this.warnings >= 3) {
            this.banned = true

            return { warnings: this.warnings, banned: true }
        }

        return { warnings: this.warnings, banned: false }
    }
}

module.exports = User