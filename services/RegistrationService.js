class RegistrationService {
constructor(users, User, inviteCode, cityService, contentFilter) {
this.users = users
this.User = User
this.inviteCode = inviteCode
this.cityService = cityService
this.contentFilter = contentFilter
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
restartRegistration(chatID) {
    const user = this.users[Number(chatID)]

    if (!user) {
        return { success: false }
    }

    // Сохраняем прежние значения для кнопки «Оставить прежнее».
    user.previousDescription = user.description || ''
    user.previousPhotos = Array.isArray(user.photos) ? user.photos.slice() : []

    user.registered = true
    user.name = null
    user.gender = null
    user.age = null
    user.description = ''
    user.city = null
    user.isGlobal = false
    user.photos = []

    // Возвращаем в ленту ранее лайкнутые/пропущенные анкеты.
    user.viewed = []

    user.waitingForInvite = false
    user.waitingForGender = false
    user.waitingForAge = false
    user.waitingForDescription = false
    user.waitingForCity = false
    user.waitingForPhotos = false
    user.waitingForName = true

    return {
        success: true,
        user
    }
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
    const nameCheck = this.contentFilter.check(text)
    if (!nameCheck.ok) {
        return {
            success: false,
            message: nameCheck.reason === 'link'
                ? '❌ Имя не должно содержать ссылок. Попробуйте другое имя.'
                : '❌ В имени нельзя использовать запрещённые слова. Попробуйте другое имя.'
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
    user.waitingForCity = true
    return {
        success: true,
        user
    }
}
applyDescription(user, text) {
    if (text === 'Пропустить') {
        user.description = ''
        return { ok: true }
    }
    if (!text || text.length > 400) {
        return {
            ok: false,
            message: '❌ Описание слишком длинное. Максимальная длина — 400 символов.'
        }
    }
    const descriptionCheck = this.contentFilter.check(text)
    if (!descriptionCheck.ok) {
        return {
            ok: false,
            message: descriptionCheck.reason === 'link'
                ? '❌ Описание не должно содержать ссылок. Перепишите описание.'
                : '❌ В описании нельзя использовать запрещённые слова. Перепишите описание.'
        }
    }
    user.description = text
    return { ok: true }
}
setDescription(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForDescription) {
        return { success: false }
    }
    const result = this.applyDescription(user, text)
    if (!result.ok) {
        return {
            success: false,
            message: result.message
        }
    }
    user.waitingForDescription = false
    user.waitingForPhotos = true
    user.photos = []
    return {
        success: true,
        user
    }
}
startDescriptionEdit(chatID) {
    const user = this.users[Number(chatID)]
    if (!user) {
        return { success: false }
    }
    user.waitingForEditDescription = true
    return {
        success: true,
        user
    }
}
cancelDescriptionEdit(chatID) {
    const user = this.users[Number(chatID)]
    if (!user) {
        return { success: false }
    }
    user.waitingForEditDescription = false
    return {
        success: true,
        user
    }
}
updateDescription(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user) {
        return { success: false }
    }
    const result = this.applyDescription(user, text)
    if (!result.ok) {
        return {
            success: false,
            message: result.message
        }
    }
    user.waitingForEditDescription = false
    return {
        success: true,
        user
    }
}
keepPreviousDescription(chatID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForDescription) {
        return { success: false }
    }
    if (!user.previousDescription) {
        return {
            success: false,
            message: 'Прежнее описание недоступно. Введите новое описание.'
        }
    }
    return this.setDescription(chatID, user.previousDescription)
}
setCity(chatID, text) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForCity) {
        return { success: false }
    }
    const value = String(text ?? '').trim()
    if (value === this.cityService.globalLabel) {
        user.city = null
        user.isGlobal = true
    } else if (this.cityService.isReserved(value)) {
        return {
            success: false,
            message: '❌ Такое название города зарезервировано. Введите другой город или выберите «🌍 Глобал».'
        }
    } else if (!this.cityService.isValid(value)) {
        return {
            success: false,
            message: '❌ Некорректное название города.\n\nВведите название города, например: Казань, или выберите «🌍 Глобал».'
        }
    } else if (!this.contentFilter.check(value).ok) {
        return {
            success: false,
            message: '❌ Недопустимое название города. Введите корректное название.'
        }
    } else {
        user.city = value
        user.isGlobal = false
    }
    user.waitingForCity = false
    user.waitingForDescription = true
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
    if (user.photos.length >= 3) {
        return {
            success: false,
            message: '❌ Можно добавить максимум 3 фотографии.'
        }
    }
    user.photos.push(photoID)
    if (user.photos.length === 3) {
        user.waitingForPhotos = false
        user.previousDescription = undefined
        user.previousPhotos = undefined
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
    user.previousDescription = undefined
    user.previousPhotos = undefined
    return {
        success: true,
        completed: true,
        user
    }
}
keepPreviousPhotos(chatID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForPhotos) {
        return {
            success: false,
            message: 'Сейчас загрузка фотографий не ожидается.'
        }
    }
    if (!user.previousPhotos || user.previousPhotos.length === 0) {
        return {
            success: false,
            message: 'Прежние фотографии недоступны. Отправьте новые фотографии.'
        }
    }
    user.photos = user.previousPhotos.slice()
    user.waitingForPhotos = false
    user.previousDescription = undefined
    user.previousPhotos = undefined
    return {
        success: true,
        completed: true,
        user
    }
}
startPhotoEdit(chatID) {
    const user = this.users[Number(chatID)]
    if (!user) {
        return { success: false }
    }
    user.editPhotos = []
    user.waitingForEditPhotos = true
    return {
        success: true,
        user
    }
}
cancelPhotoEdit(chatID) {
    const user = this.users[Number(chatID)]
    if (!user) {
        return { success: false }
    }
    user.editPhotos = undefined
    user.waitingForEditPhotos = false
    return {
        success: true,
        user
    }
}
addEditPhoto(chatID, photoID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForEditPhotos) {
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
    if (user.editPhotos.length >= 3) {
        return {
            success: false,
            message: '❌ Можно добавить максимум 3 фотографии.'
        }
    }
    user.editPhotos.push(photoID)
    if (user.editPhotos.length === 3) {
        user.photos = user.editPhotos
        user.editPhotos = undefined
        user.waitingForEditPhotos = false
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
finishPhotoEdit(chatID) {
    const user = this.users[Number(chatID)]
    if (!user || !user.waitingForEditPhotos) {
        return {
            success: false,
            message: 'Сейчас загрузка фотографий не ожидается.'
        }
    }
    if (!Array.isArray(user.editPhotos) || user.editPhotos.length === 0) {
        return {
            success: false,
            message: '❌ Нужно добавить хотя бы одну новую фотографию.'
        }
    }
    user.photos = user.editPhotos
    user.editPhotos = undefined
    user.waitingForEditPhotos = false
    return {
        success: true,
        completed: true,
        user
    }
}

}

module.exports = RegistrationService