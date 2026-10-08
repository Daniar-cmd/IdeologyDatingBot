require('dotenv').config()

const TelegramApi = require('node-telegram-bot-api')
const token = process.env.BOT_TOKEN
const bot = new TelegramApi(token, { polling: true })

const inviteCode = 'YABLOKO'
const users = {}

function findMatch(chatID) {
    const user = users[chatID]
    const matches = []
    for (const otherChatID in users) {
        if (otherChatID === String(chatID)) {
            continue
        }
        const otherUser = users[otherChatID]
        if (!otherUser?.registered) {
            continue
        }
        if (!otherUser.name || !otherUser.age || !otherUser.city) {
            continue
        }
        if (!otherUser.photos?.length) {
            continue
        }
        if (user.gender === otherUser.gender) {
            continue
        }
        if (user.city.toLowerCase() !== otherUser.city.toLowerCase()) {
            continue
        }
        if (Math.abs(user.age - otherUser.age) > 3) {
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
    const randomIndex = Math.floor(Math.random() * matches.length)
    return matches[randomIndex]
}

bot.on('message', msg => {
    const chatID = msg.chat.id
    const text = msg.text
    if (!users[chatID]) {
    users[chatID] = {}
}
users[chatID].username = msg.from.username

    //ПРИВЕТСТВИЕ
    if (text === '/start') {
        users[chatID] = {
            registered: false,
            waitingForInvite: true
        }
        bot.sendMessage(
            chatID,
            'Привет! Это IdeologyDatingBot. Здесь ты сможешь найти друзей или вторую половинку на основании общих взглядов, ценностей и мировоззрения.\n\nВведите инвайт-код для входа в систему:'
        )
        return
    }

// ВВЕДИТЕ ИНВАЙТ И ИМЯ
if (users[chatID]?.waitingForInvite) {
    if (text === inviteCode) {
        users[chatID].registered = true
        users[chatID].waitingForInvite = false
        users[chatID].waitingForName = true
        bot.sendMessage(
            chatID,
            '✅ Инвайт-код принят! Вы успешно вошли в систему.\n\n👤 Давайте создадим ваш профиль.\n\nКак вас зовут?'
        )
        return
    }
    bot.sendMessage(
        chatID,
        '❌ Неверный инвайт-код. Попробуйте ещё раз.'
    )
    return
}

// ВЫБЕРИТЕ ИМЯ
if (users[chatID]?.waitingForName) {
    users[chatID].name = text
    users[chatID].waitingForName = false
    users[chatID].waitingForGender = true
    bot.sendMessage(
        chatID,
        `Отлично, ${text}! Ваше имя сохранено.\n\nТеперь выберите ваш пол:`,
        {
            reply_markup: {
                keyboard: [
                    ['👨 Мужской', '👩 Женский']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    )
    return
}

// ПРОВЕРКА ПОЛА
if (users[chatID]?.waitingForGender) {
    if (text === '👨 Мужской') {
        users[chatID].gender = 'male'
    } else if (text === '👩 Женский') {
        users[chatID].gender = 'female'
    } else {
        bot.sendMessage(
            chatID,
            'Пожалуйста, выберите один из вариантов с помощью кнопок.'
        )
        return
    }
    users[chatID].waitingForGender = false
    users[chatID].waitingForAge = true
    bot.sendMessage(
        chatID,
        '✅ Пол сохранён.\n\n🎂 Сколько вам лет?\n\nВведите возраст двумя цифрами. Минимальный возраст для регистрации — 16 лет.\n\n⚠️ Пожалуйста, указывайте реальный возраст. Подделка возраста недопустима.'
    )
    return
}

// ПРОВЕРКА ВОЗРАСТА
if (users[chatID]?.waitingForAge) {
    const age = Number(text)
    if (!/^\d{2}$/.test(text) || age < 16 || age > 99) {
        bot.sendMessage(
            chatID,
            '❌ Некорректный возраст.\n\nВведите реальный возраст двумя цифрами. Минимальный возраст — 16 лет.'
        )
        return
    }
    users[chatID].age = age
    users[chatID].waitingForAge = false
    users[chatID].waitingForDescription = true
    bot.sendMessage(
        chatID,
        '✅ Возраст сохранён.\n\n📝 Расскажите немного о себе.\n\nОписание необязательно. Максимальная длина — 400 символов.',
        {
            reply_markup: {
                keyboard: [
                    ['Пропустить']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        }
    )
    return
}

// ПРОВЕРКА ОПИСАНИЯ
if (users[chatID]?.waitingForDescription) {
    if (text === 'Пропустить') {
        users[chatID].description = ''
    } else if (text && text.length <= 400) {
        users[chatID].description = text
    } else {
        bot.sendMessage(
            chatID,
            '❌ Описание слишком длинное. Максимальная длина — 400 символов.'
        )
        return
    }
    users[chatID].waitingForDescription = false
    users[chatID].waitingForCity = true
    bot.sendMessage(
        chatID,
        '✅ Описание сохранено.\n\n🌍 В каком городе вы живёте?'
    )
    return
}

// ПРОВЕРКА ГОРОДА
if (users[chatID]?.waitingForCity) {
    if (!/^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/.test(text)) {
        bot.sendMessage(
            chatID,
            '❌ Некорректное название города.\n\nИспользуйте только русские или латинские буквы.'
        )
        return
    }
    users[chatID].city = text
    users[chatID].waitingForCity = false
    users[chatID].waitingForPhotos = true
    users[chatID].photos = []
    bot.sendMessage(
        chatID,
        '✅ Город сохранён.\n\n📸 Теперь отправьте от 1 до 5 фотографий для вашей анкеты.'
    )
    return
}

// ПРОВЕРКА ФОТО
if (users[chatID]?.waitingForPhotos) {
    if (text === 'Готово') {
        if (users[chatID].photos.length === 0) {
            bot.sendMessage(
                chatID,
                '❌ Нужно загрузить хотя бы одну фотографию.'
            )
            return
        }
        users[chatID].waitingForPhotos = false
        bot.sendMessage(
            chatID,
            '🎉 Поздравляем! Анкета успешно создана.\n\nЧтобы посмотреть её, используйте команду /profile.',
            {
                reply_markup: {
                    remove_keyboard: true
                }
            }
        )
        return
    }
    if (!msg.photo) {
        bot.sendMessage(
            chatID,
            '❌ Пожалуйста, отправьте фотографию.'
        )
        return
    }
    if (users[chatID].photos.length >= 5) {
        bot.sendMessage(
            chatID,
            '❌ Можно добавить максимум 5 фотографий.'
        )
        return
    }
    const photo = msg.photo[msg.photo.length - 1].file_id
    users[chatID].photos.push(photo)
if (users[chatID].photos.length === 5) {
    users[chatID].waitingForPhotos = false
    bot.sendMessage(
        chatID,
        '🎉 Поздравляем! Анкета успешно создана.\n\nЧтобы посмотреть её, используйте команду /profile.',
        {
            reply_markup: {
                remove_keyboard: true
            }
        }
    )
} else {
        bot.sendMessage(
            chatID,
            `✅ Фото добавлено. Сейчас загружено: ${users[chatID].photos.length}/5.\n\nМожете отправить ещё фотографии или нажать «Готово».`,
            {
                reply_markup: {
                    keyboard: [
                        ['Готово']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        )
    }
    return
}

// ПРОСМОТР СВОЕЙ АНКЕТЫ
if (text === '/profile') {
    const user = users[chatID]
    if (!user || !user.registered || !user.name || !user.age || !user.city || !user.photos?.length) {
        bot.sendMessage(
            chatID,
            '❌ Вы ещё не завершили создание анкеты.'
        )
        return
    }
    sendProfile(chatID, user)
    const otherUser = findMatch(chatID)
    if (!otherUser) {
        bot.sendMessage(
            chatID,
            '😔 Пока не найдено подходящих анкет.\n\nПопробуйте зайти позже.'
        )
        return
    }
    sendProfile(chatID, otherUser)
    return
}

if (text === '/lenta') {
    const user = users[chatID]
    if (!user || !user.registered || !user.name || !user.age || !user.city || !user.photos?.length) {
        bot.sendMessage(
            chatID,
            '❌ Сначала необходимо завершить создание анкеты.'
        )
        return
    }
    const match = findMatch(chatID)
    if (!match) {
        bot.sendMessage(
            chatID,
            '😔 Пока не найдено подходящих анкет.'
        )
        return
    }
    sendDatingProfile(chatID, match.chatID)
    return
}

function sendDatingProfile(chatID, otherChatID) {
    const user = users[otherChatID]
    const profileText = `👤 ${user.name}, ${user.age}
🌍 ${user.city}
${user.description }`
    bot.sendPhoto(
        chatID,
        user.photos[0],
        {
            caption: profileText,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❤️', callback_data: `like_${otherChatID}` },
                        { text: '❌', callback_data: `skip_${otherChatID}` }
                    ]
                ]
            }
        }
    )
}

bot.on('callback_query', query => {
    const chatID = query.message.chat.id
    const data = query.data
    const user = users[chatID]

    if (!user) {
        bot.answerCallbackQuery(query.id)
        return
    }

    if (data.startsWith('skip_')) {
        const otherChatID = Number(data.replace('skip_', ''))

        if (!user.viewed) {
            user.viewed = []
        }

        if (!user.viewed.includes(otherChatID)) {
            user.viewed.push(otherChatID)
        }

        bot.answerCallbackQuery(query.id)
        bot.deleteMessage(chatID, query.message.message_id)

        const nextProfile = findMatch(chatID)

        if (!nextProfile) {
            bot.sendMessage(
                chatID,
                '😔 Пока больше нет подходящих анкет.'
            )
            return
        }

        sendDatingProfile(chatID, nextProfile.chatID)
        return
    }

    if (data.startsWith('like_')) {
        const otherChatID = Number(data.replace('like_', ''))
        const likedUser = users[otherChatID]

        if (!likedUser) {
            bot.answerCallbackQuery(query.id)
            return
        }

        if (!user.likes) {
            user.likes = []
        }

        if (!user.likedBy) {
            user.likedBy = []
        }

        if (!user.viewed) {
            user.viewed = []
        }

        if (!user.likes.includes(otherChatID)) {
            user.likes.push(otherChatID)
        }

        if (!user.viewed.includes(otherChatID)) {
            user.viewed.push(otherChatID)
        }

        bot.answerCallbackQuery(
            query.id,
            {
                text: '❤️ Лайк отправлен!'
            }
        )

        bot.deleteMessage(chatID, query.message.message_id)

        bot.sendMessage(
            chatID,
            '❤️ Лайк отправлен! Ждём ответа.'
        )

        if (!likedUser.likedBy.includes(chatID)) {
            likedUser.likedBy.push(chatID)
        }

        bot.sendMessage(
            otherChatID,
            `❤️ Ваша анкета понравилась пользователю ${user.name}!`
        )

        const nextProfile = findMatch(chatID)

        if (!nextProfile) {
            bot.sendMessage(
                chatID,
                '😔 Больше подходящих анкет пока нет.'
            )
            return
        }

        sendDatingProfile(chatID, nextProfile.chatID)
    }
})

})