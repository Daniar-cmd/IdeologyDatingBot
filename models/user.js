class User {
    constructor({
        chatID,
        username = null,
        registered = false,
        name = null,
        gender = null,
        lookingFor = null,
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
        bannedUntil = null,
        bannedAt = null,
        bannedBy = null,
        banReason = null,
        warnings = 0,
        createdAt = null
    }) {
        this.chatID = chatID
        this.username = username
        this.registered = registered
        this.name = name
        this.gender = gender
        // Кого ищет пользователь: 'male' | 'female' | 'any' | null (не выбран).
        // Для старых анкет без значения действует правило по умолчанию:
        // девушки видят парней, парни — девушек (см. searchPreference).
        this.lookingFor = lookingFor || null
        this.age = age
        this.description = description
        this.city = city
        this.isGlobal = Boolean(isGlobal)
        this.hidden = Boolean(hidden)
        this.banned = Boolean(banned)
        this.bannedUntil = bannedUntil ? new Date(bannedUntil) : null
        this.bannedAt = bannedAt ? new Date(bannedAt) : null
        this.bannedBy = bannedBy || null
        this.banReason = banReason || null
        this.warnings = Number(warnings) || 0
        this.createdAt = createdAt ? new Date(createdAt) : null

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

    // Кого пользователь ищет: 'male' | 'female' | 'any'.
    // Если выбор не сделан (старые анкеты) — противоположный пол.
    searchPreference() {
        if (this.lookingFor === 'male' || this.lookingFor === 'female' || this.lookingFor === 'any') {
            return this.lookingFor
        }

        if (this.gender === 'male') {
            return 'female'
        }

        if (this.gender === 'female') {
            return 'male'
        }

        return 'any'
    }

    // Подходит ли анкета пола gender под предпочтения пользователя.
    isInterestedIn(gender) {
        const preference = this.searchPreference()

        return preference === 'any' || preference === gender
    }

    // Учитывает срок временного бана: истёкший бан активным не считается.
    isBannedNow() {
        if (!this.banned) {
            return false
        }

        if (!this.bannedUntil) {
            return true
        }

        return this.bannedUntil.getTime() > Date.now()
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