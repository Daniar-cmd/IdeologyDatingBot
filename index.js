require('dotenv').config()

const TelegramApi = require('node-telegram-bot-api')
const token = process.env.BOT_TOKEN
const { db, initDatabase } = require('./database')
const bot = new TelegramApi(token, { polling: false })
const User = require('./models/user')
const UserRepository = require('./repositories/UserRepository')
const RegistrationService = require('./services/RegistrationService')
const LikeService = require('./services/LikeService')
const MatchingService = require('./services/MatchingService')
const ProfileService = require('./services/ProfileService')

bot.setMyCommands([
    { command: 'start', description: 'Запустить бота, начать все заново' },
    { command: 'profile', description: 'Посмотреть свою анкету' },
    { command: 'lenta', description: 'Смотреть анкеты пользователей' },
])

const inviteCode = 'YABLOKO'
const users = {}

const userRepository = new UserRepository(db, User)
const likeService = new LikeService(users)
const matchingService = new MatchingService(users)
const profileService = new ProfileService(users)
const registrationService = new RegistrationService(
    users,
    User,
    inviteCode
)

async function loadUsers() {
    const loadedUsers = await userRepository.findAll()

    for (const user of loadedUsers) {
        users[user.chatID] = user
    }

    console.log(`Загружено анкет: ${loadedUsers.length}`)
}

async function saveAllUsers() {
    await userRepository.saveAll(users)
}

setInterval(() => {
    saveAllUsers().catch(error => {
        console.error('Ошибка сохранения анкет:', error)
    })
}, 5000)



async function sendDatingProfile(chatID, otherChatID) {
    const user = users[otherChatID]

    const profileText = `👤 ${user.name}, ${user.age}
🌍 ${user.city}

${user.description || ''}`

    try {
        if (user.photos.length === 1) {
            await bot.sendPhoto(chatID, user.photos[0], {
                caption: profileText,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❤️', callback_data: `like_${otherChatID}` },
                        { text: '❌', callback_data: `skip_${otherChatID}` }
                    ]]
                }
            })
            return
        }

        const media = user.photos.map((photo, index) => ({
            type: 'photo',
            media: photo,
            ...(index === 0 ? { caption: profileText } : {})
        }))

        const sentMessages = await bot.sendMediaGroup(chatID, media)

        const lastMessage = sentMessages[sentMessages.length - 1]

        await bot.sendMessage(chatID, 'Выберите действие:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '❤️', callback_data: `like_${otherChatID}` },
                    { text: '❌', callback_data: `skip_${otherChatID}` }
                ]]
            },
            reply_to_message_id: lastMessage.message_id
        })
    } catch (error) {
        console.error('Ошибка отправки анкеты:', error.message)
        bot.sendMessage(chatID, '❌ Не удалось отправить анкету. Попробуйте позже.')
    }
}

//ПОКАЗ СОБСТВЕННОЙ АНКЕТЫ
async function sendProfile(chatID, user) {
    const profileText = `👤 ${user.name}, ${user.age}
🌍 ${user.city}

${user.description || ''}`

    try {
        if (!user.photos || user.photos.length === 0) {
            await bot.sendMessage(chatID, '❌ В анкете нет фотографий.')
            return
        }

        if (user.photos.length === 1) {
            await bot.sendPhoto(chatID, user.photos[0], {
                caption: profileText
            })
            return
        }

        const media = user.photos.map((photo, index) => ({
            type: 'photo',
            media: photo,
            ...(index === 0 ? { caption: profileText } : {})
        }))

        await bot.sendMediaGroup(chatID, media)
    } catch (error) {
        console.error('Ошибка показа собственной анкеты:', error.message)
        await bot.sendMessage(
            chatID,
            '❌ Не удалось показать анкету. Попробуйте позже.'
        )
    }
}


function sendLikeBackProfile(chatID, otherChatID) {
    const user = users[otherChatID]

    if (!user || !user.photos || user.photos.length === 0) {
        bot.sendMessage(chatID, 'Не удалось загрузить анкету пользователя.')
        return
    }

    const profileText = `❤️ Этот человек поставил вам лайк!

👤 ${user.name}, ${user.age}
🌍 ${user.city}

${user.description || ''}

Симпатия взаимна?`

    bot.sendPhoto(chatID, user.photos[0], {
        caption: profileText,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '❤️ Лайкнуть в ответ', callback_data: `match_${otherChatID}` },
                    { text: '❌', callback_data: `reject_${otherChatID}` }
                ]
            ]
        }
    })
} 

bot.on('message', msg => {
    const chatID = msg.chat.id
    const text = msg.text
    if (users[chatID]?.waitingForAge &&
    (text === '👨 Мужской' || text === '👩 Женский')) {
    bot.sendMessage(chatID, '❌ Сейчас нужно ввести возраст числом.')
    return
    }
    if (!users[chatID]) {
        users[chatID] = new User({
            chatID: Number(chatID),
            username: msg.from.username || null,
            registered: false
        })
    }

    users[chatID].username = msg.from.username || null

    //ПРИВЕТСТВИЕ
    if (text === '/start') {
    users[chatID] = new User({
        chatID: Number(chatID),
        username: msg.from.username || null,
        registered: false
    })

    users[chatID].waitingForInvite = true
        bot.sendMessage(
            chatID,
            'Привет! Это IdeologyDatingBot. Здесь ты сможешь найти друзей или вторую половинку на основании общих взглядов, ценностей и мировоззрения.\n\nВведите инвайт-код для входа в систему:'
        )
        return
    }

// ВВЕДИТЕ ИНВАЙТ И ИМЯ
if (users[chatID]?.waitingForInvite) {
const result = registrationService.validateInvite(chatID, text)

if (!result.success) {
    bot.sendMessage(chatID, result.message)
    return
}
bot.sendMessage(
    chatID,
    '✅ Инвайт-код принят! Вы успешно вошли в систему.\n\n👤 Давайте создадим ваш профиль.\n\nКак вас зовут?'
)
return

}

// ВЫБЕРИТЕ ИМЯ
// ВЫБЕРИТЕ ИМЯ
if (users[chatID]?.waitingForName) {
const result = registrationService.setName(chatID, text)

if (!result.success) {
    bot.sendMessage(
        chatID,
        result.message || '❌ Не удалось сохранить имя. Попробуйте ещё раз.'
    )
    return
}
bot.sendMessage(
    chatID,
    `Отлично, ${result.user.name}! Ваше имя сохранено.\n\nТеперь выберите ваш пол:`,
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
const result = registrationService.setGender(chatID, text)

if (!result.success) {
    bot.sendMessage(
        chatID,
        result.message || 'Не удалось сохранить пол. Попробуйте ещё раз.'
    )
    return
}
bot.sendMessage(
    chatID,
    '✅ Пол сохранён.\n\n🎂 Сколько вам лет?\n\nМинимальный возраст для регистрации — 16 лет.\n\n⚠️ Пожалуйста, указывайте реальный возраст. Подделка возраста недопустима.',
    {
        reply_markup: {
            remove_keyboard: true
        }
    }
)
return

}

// ПРОВЕРКА ВОЗРАСТА
if (users[chatID]?.waitingForAge) {
const result = registrationService.setAge(chatID, text)

if (!result.success) {
    bot.sendMessage(
        chatID,
        result.message || 'Не удалось сохранить возраст. Попробуйте ещё раз.'
    )
    return
}
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
const result = registrationService.setDescription(chatID, text)

if (!result.success) {
    bot.sendMessage(
        chatID,
        result.message || 'Не удалось сохранить описание. Попробуйте ещё раз.'
    )
    return
}
bot.sendMessage(
    chatID,
    '✅ Описание сохранено.\n\n🌍 В каком городе вы живёте?',
    {
        reply_markup: {
            remove_keyboard: true
        }
    }
)
return

}

// ПРОВЕРКА ГОРОДА
if (users[chatID]?.waitingForCity) {
const result = registrationService.setCity(chatID, text)

if (!result.success) {
    bot.sendMessage(
        chatID,
        result.message || 'Не удалось сохранить город. Попробуйте ещё раз.'
    )
    return
}
bot.sendMessage(
    chatID,
    '✅ Город сохранён.\n\n📸 Теперь отправьте от 1 до 5 фотографий для вашей анкеты.',
    {
        reply_markup: {
            remove_keyboard: true
        }
    }
)
return

}

// ПРОВЕРКА ФОТО
// ЗАГРУЗКА ФОТОГРАФИЙ
if (users[chatID]?.waitingForPhotos) {
    const user = users[chatID]

    // Завершение загрузки по кнопке «Готово»
    if (text === 'Готово') {
        const result = registrationService.finishPhotos(chatID)

        if (!result.success) {
            bot.sendMessage(chatID, result.message)
            return
        }

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

    // Проверяем, что пользователь отправил фотографию
    if (!msg.photo || msg.photo.length === 0) {
        bot.sendMessage(
            chatID,
            '❌ Пожалуйста, отправьте фотографию или нажмите «Готово».'
        )
        return
    }

    // Проверяем лимит до добавления фотографии
    if (user.photos.length >= 5) {
        bot.sendMessage(
            chatID,
            '❌ Можно добавить максимум 5 фотографий.'
        )
        return
    }

    // Берём фотографию максимального доступного размера
    const photo = msg.photo[msg.photo.length - 1].file_id

    const result = registrationService.addPhoto(chatID, photo)

    if (!result.success) {
        bot.sendMessage(chatID, result.message)
        return
    }

    // Если загружено 5 фотографий, завершаем регистрацию
    if (result.completed) {
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

    // Если фотографий меньше 5, предлагаем загрузить ещё
    bot.sendMessage(
        chatID,
        `✅ Фото добавлено. Сейчас загружено: ${result.user.photos.length}/5.\n\nМожете отправить ещё фотографии или нажать «Готово».`,
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

    return
}

// ПРОСМОТР СВОЕЙ АНКЕТЫ
if (text === '/profile') {
    const user = profileService.getProfile(chatID)

    if (!profileService.isProfileComplete(chatID)) {
        bot.sendMessage(
            chatID,
            '❌ Вы ещё не завершили создание анкеты.'
        )
        return
    }

    sendProfile(chatID, user)
    return
}

if (text === '/lenta') {
    const user = profileService.getProfile(chatID)

    if (!profileService.isProfileComplete(chatID)) {
        bot.sendMessage(
            chatID,
            '❌ Сначала необходимо завершить создание анкеты.'
        )
        return
    }

    const match = matchingService.findMatch(chatID)

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

})

bot.on('callback_query', query => {
    const chatID = query.message.chat.id
    const data = query.data
    const user = users[chatID]
    // ПРОСМОТР АНКЕТЫ ЧЕЛОВЕКА, КОТОРЫЙ ПОСТАВИЛ ЛАЙК
    if (data.startsWith('viewlike_')) {
        const otherChatID = Number(data.replace('viewlike_', ''))
        const likedUser = users[otherChatID]

        if (!likedUser) {
            bot.answerCallbackQuery(query.id, {
                text: 'Анкета больше недоступна.'
            })
            return
        }

        bot.answerCallbackQuery(query.id)

        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: chatID,
                message_id: query.message.message_id
            }
        ).catch(() => {})

        sendLikeBackProfile(chatID, otherChatID)
        return
    }

    // ОТКЛОНЕНИЕ ВХОДЯЩЕГО ЛАЙКА
    if (data.startsWith('rejectlike_')) {
        bot.answerCallbackQuery(query.id, {
            text: 'Лайк отклонён.'
        })

        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: chatID,
                message_id: query.message.message_id
            }
        ).catch(() => {})

        bot.sendMessage(chatID, 'Вы отклонили лайк.')
        return
    }

    // ОТВЕТ НА ВХОДЯЩИЙ ЛАЙК
if (data.startsWith('match_')) {
    const otherChatID = Number(data.replace('match_', ''))
    const likedUser = users[otherChatID]

    if (!likedUser) {
        bot.answerCallbackQuery(query.id, {
            text: 'Анкета больше недоступна.'
        })
        return
    }

    const result = likeService.createMatch(chatID, otherChatID)

    if (!result.success) {
        bot.answerCallbackQuery(query.id, {
            text: result.message
        })
        return
    }

if (!user.hasLiked(otherChatID)) {
    user.likes.push(otherChatID)
}

    bot.answerCallbackQuery(query.id, {
        text: '❤️ У вас взаимная симпатия!'
    })

    // Убираем кнопки, чтобы ответ нельзя было отправить повторно
    bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
            chat_id: chatID,
            message_id: query.message.message_id
        }
    ).catch(() => {})

    // Получаем Telegram username обоих пользователей
    const currentUsername = user.username
        ? `@${user.username}`
        : 'Username не указан'

    const otherUsername = likedUser.username
        ? `@${likedUser.username}`
        : 'Username не указан'

    // Уведомляем пользователя А и отправляем ему анкету Б
    if (user.photos && user.photos.length > 0) {
        bot.sendPhoto(otherChatID, user.photos[0], {
            caption: `👤 ${user.name}, ${user.age}
🌍 ${user.city}n

${user.description || ''}

❤️ Этот пользователь ответил вам взаимностью!
Telegram: ${currentUsername}`
        }).catch(error => {
            console.error('Ошибка отправки анкеты после мэтча:', error.message)
        })
    }

    // Уведомляем пользователя Б — без повторной отправки анкеты А
    bot.sendMessage(
        chatID,
        `🎉 Это мэтч!\n\n❤️ Вы понравились друг другу!\n\nTelegram пользователя: ${otherUsername}`
    )

    return
    }

// ОТКЛОНЕНИЕ ВХОДЯЩЕГО ЛАЙКА
if (data.startsWith('reject_')) {
    bot.answerCallbackQuery(query.id, {
        text: 'Вы пропустили эту анкету.'
    })

    bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
            chat_id: chatID,
            message_id: query.message.message_id
        }
    ).catch(() => {})

    bot.sendMessage(
        chatID,
        'Вы пропустили эту анкету. Продолжайте знакомиться в /lenta!'
    )

    return
}

    if (!user) {
        bot.answerCallbackQuery(query.id)
        return
    }

    if (data.startsWith('skip_')) {
        const otherChatID = Number(data.replace('skip_', ''))

        bot.answerCallbackQuery(query.id)

        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: chatID,
                message_id: query.message.message_id
            }
        ).catch(() => {})

        user.addViewed(otherChatID)

        const nextProfile = matchingService.findMatch(chatID)

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

    //МЕХАНИКА ЛАЙКА
    if (data.startsWith('like_')) {
        const otherChatID = Number(data.replace('like_', ''))
        const likedUser = users[otherChatID]

        bot.answerCallbackQuery(query.id)
        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: chatID,
                message_id: query.message.message_id
            }
        ).catch(() => {})

        if (!likedUser) {
            bot.answerCallbackQuery(query.id)
            return
        }

        const result = likeService.sendLike(chatID, otherChatID)

        if (!result.success) {
            bot.sendMessage(chatID, result.message)
            return
        }

        bot.sendMessage(chatID, '❤️ Лайк отправлен! Ждём ответа.')

        bot.sendMessage(
            otherChatID,
            '❤️ Вы понравились одному человеку!\n\nХотите посмотреть его анкету?',
            {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '✅ Да',
                            callback_data: `viewlike_${chatID}`
                        },
                        {
                            text: '❌ Нет',
                            callback_data: `rejectlike_${chatID}`
                        }
                    ]]
                }
            }
        ).catch(error => {
            console.error('Не удалось отправить уведомление о лайке:', error.message)
        })

        const nextProfile = matchingService.findMatch(chatID)

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
async function startBot() {
    try {
        await initDatabase()
        await loadUsers()
        await saveAllUsers()

        await bot.startPolling()

        console.log('Бот запущен и подключён к PostgreSQL!')
    } catch (error) {
        console.error('Ошибка запуска бота:', error)
        process.exit(1)
    }
}

startBot()