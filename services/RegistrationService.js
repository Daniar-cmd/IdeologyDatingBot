class RegistrationService {
constructor(users, User, inviteCode) {
this.users = users
this.User = User
this.inviteCode = inviteCode
}

getOrCreateUser(chatID, username = null) {
    const id = Number(chatID)
    if (!this.users[id]) {
        this.users[id] = new this.User({
            chatID: id,
            username,
            registered: false
        })
    }
    this.users[id].username = username
    return this.users[id]
}
startRegistration(chatID, username = null) {
    const user = new this.User({
        chatID: Number(chatID),
        username,
        registered: false
    })
    user.waitingForInvite = true
    this.users[Number(chatID)] = user
    return user
}
validateInvite(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForInvite) {
        return {
            success: false,
            message: 'Регистрация не ожидает инвайт-код.'
        }
    }
    if (text !== this.inviteCode) {
        return {
            success: false,
            message: '❌ Неверный инвайт-код. Попробуйте ещё раз.'
        }
    }
    user.registered = true
    user.waitingForInvite = false
    user.waitingForName = true
    return {
        success: true,
        user
    }
}
setName(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForName) {
        return { success: false }
    }
    if (!text || !/\p{L}/u.test(text)) {
        return {
            success: false,
            message: '❌ Имя должно содержать хотя бы одну букву.\n\nПопробуйте ещё раз.\n'
        }
    }
    user.name = text.trim()
    user.waitingForName = false
    user.waitingForGender = true
    return {
        success: true,
        user
    }
}
setGender(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForGender) {
        return { success: false }
    }
    if (text === '👨 Мужской') {
        user.gender = 'male'
    } else if (text === '👩 Женский') {
        user.gender = 'female'
    } else {
        return {
            success: false,
            message: 'Пожалуйста, выберите один из вариантов с помощью кнопок.'
        }
    }
    user.waitingForGender = false
    user.waitingForAge = true
    return {
        success: true,
        user
    }
}
setAge(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForAge) {
        return { success: false }
    }
    const age = Number(text)
    if (!/^\d{2}$/.test(text || '') || age < 16 || age > 99) {
        return {
            success: false,
            message: '❌ Некорректный возраст.\n\nВведите реальный возраст. Минимальный возраст — 16 лет.'
        }
    }
    user.age = age
    user.waitingForAge = false
    user.waitingForDescription = true
    return {
        success: true,
        user
    }
}
setDescription(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForDescription) {
        return { success: false }
    }
    if (text === 'Пропустить') {
        user.description = ''
    } else if (text && text.length <= 400) {
        user.description = text
    } else {
        return {
            success: false,
            message: '❌ Описание слишком длинное. Максимальная длина — 400 символов.'
        }
    }
    user.waitingForDescription = false
    user.waitingForCity = true
    return {
        success: true,
        user
    }
}
setCity(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForCity) {
        return { success: false }
    }
    if (!/^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/.test(text || '')) {
        return {
            success: false,
            message: '❌ Некорректное название города.\n\nИспользуйте только русские или латинские буквы.'
        }
    }
    user.city = text
    user.waitingForCity = false
    user.waitingForPhotos = true
    user.photos = []
    return {
        success: true,
        user
    }
}
addPhoto(chatID, photoID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForPhotos) {
        return {
            success: false,
            message: 'Сейчас загрузка фотографий не ожидается.'
        }
    }
    if (!photoID) {
        return {
            success: false,
            message: '❌ Пожалуйста, отправьте фотографию.'
        }
    }
    if (user.photos.length >= 5) {
        return {
            success: false,
            message: '❌ Можно добавить максимум 5 фотографий.'
        }
    }
    user.photos.push(photoID)
    if (user.photos.length === 5) {
        user.waitingForPhotos = false
        return {
            success: true,
            completed: true,
            user
        }
    }
    return {
        success: true,
        completed: false,
        user
    }
}
finishPhotos(chatID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForPhotos) {
        return {
            success: false,
            message: 'Сейчас загрузка фотографий не ожидается.'
        }
    }
    if (user.photos.length === 0) {
        return {
            success: false,
            message: '❌ Нужно загрузить хотя бы одну фотографию.'
        }
    }
    user.waitingForPhotos = false
    return {
        success: true,
        completed: true,
        user
    }
}

}

module.exports = RegistrationService