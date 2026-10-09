require('dotenv').config()

const TelegramApi = require('node-telegram-bot-api')
const token = process.env.BOT_TOKEN
const { db, initDatabase } = require('./database')
const bot = new TelegramApi(token, { polling: false })

const inviteCode = 'YABLOKO'
const users = {}

async function loadUsers() {
    const result = await db.query('SELECT * FROM users')

    for (const row of result.rows) {
        const user = {
            username: row.username || undefined,
            registered: Boolean(row.registered),
            name: row.name || undefined,
            gender: row.gender || undefined,
            age: row.age ?? undefined,
            description: row.description || '',
            city: row.city || undefined,
            photos: row.photos || [],
            likes: row.likes || [],
            likedBy: row.liked_by || [],
            viewed: row.viewed || []
        }

        if (row.state) {
            user[row.state] = true
        }

        users[row.chat_id] = user
    }

    console.log(`Загружено анкет: ${result.rows.length}`)
}

async function saveAllUsers() {
    for (const [chatID, user] of Object.entries(users)) {
        const state = Object.keys(user).find(
            key => key.startsWith('waitingFor') && user[key] === true
        ) || null

        await db.query(`
            INSERT INTO users (
                chat_id, username, registered, name, gender, age,
                description, city, photos, likes, liked_by, viewed, state
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (chat_id) DO UPDATE SET
                username = EXCLUDED.username,
                registered = EXCLUDED.registered,
                name = EXCLUDED.name,
                gender = EXCLUDED.gender,
                age = EXCLUDED.age,
                description = EXCLUDED.description,
                city = EXCLUDED.city,
                photos = EXCLUDED.photos,
                likes = EXCLUDED.likes,
                liked_by = EXCLUDED.liked_by,
                viewed = EXCLUDED.viewed,
                state = EXCLUDED.state
        `, [
            String(chatID),
            user.username || null,
            user.registered ? 1 : 0,
            user.name || null,
            user.gender || null,
            user.age ?? null,
            user.description || '',
            user.city || null,
            JSON.stringify(user.photos || []),
            JSON.stringify(user.likes || []),
            JSON.stringify(user.likedBy || []),
            JSON.stringify(user.viewed || []),
            state
        ])
    }
}

setInterval(() => {
    saveAllUsers().catch(error => {
        console.error('Ошибка сохранения анкет:', error)
    })
}, 5000)

function findMatch(chatID) {
    const user = users[chatID]
    const matches = []
    for (const otherChatID in users) {
        if (otherChatID === String(chatID)) {
            continue
        }
        const otherUser = users[otherChatID]

        // Пропускаем анкеты, с которыми уже взаимодействовали
        if (user.viewed?.includes(Number(otherChatID))) {
            continue
        }

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
        if (Math.abs(user.age - otherUser.age) > 10) {
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

// ПОКАЗ СОБСТВЕННОЙ АНКЕТЫ
function sendProfile(chatID, user) {
    const profileText = `👤 ${user.name}, ${user.age}
🌍 ${user.city}

${user.description || ''}`

    bot.sendPhoto(
        chatID,
        user.photos[0],
        {
            caption: profileText
        }
    ).catch(error => {
        console.error('Ошибка показа собственной анкеты:', error.message)
        bot.sendMessage(
            chatID,
            '❌ Не удалось показать анкету. Попробуйте позже.'
        )
    })
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
    if (!users[chatID]) {
        users[chatID] = {
            registered: false
        }
    }

    users[chatID].username = msg.from.username || null

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
// ВЫБЕРИТЕ ИМЯ
if (users[chatID]?.waitingForName) {
    // Проверяем, что пользователь отправил текст
    if (!text || !/\p{L}/u.test(text)) {
        bot.sendMessage(
            chatID,
            '❌ Имя должно содержать хотя бы одну букву.\n\nПопробуйте ещё раз.\n'
        )
        return
    }

    users[chatID].name = text.trim()
    users[chatID].waitingForName = false
    users[chatID].waitingForGender = true

    bot.sendMessage(
        chatID,
        `Отлично, ${users[chatID].name}! Ваше имя сохранено.\n\nТеперь выберите ваш пол:`,
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

    if (
        !user ||
        !user.registered ||
        !user.name ||
        !user.age ||
        !user.city ||
        !user.photos?.length
    ) {
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

})

bot.on('callback_query', query => {
    const chatID = query.message.chat.id
    const data = query.data
    const user = users[chatID]

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

    // Проверяем, действительно ли этот пользователь ранее поставил лайк
    if (!likedUser.likes || !likedUser.likes.includes(chatID)) {
        bot.answerCallbackQuery(query.id, {
            text: 'Этот лайк уже недействителен.'
        })
        return
    }

    // Записываем взаимный лайк
    if (!user.likes) {
        user.likes = []
    }

    if (!user.likes.includes(otherChatID)) {
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

    // Уведомляем обоих участников
    bot.sendMessage(
        chatID,
        `🎉 Это мэтч!\n\n❤️ Вы понравились друг другу!\n\nTelegram пользователя: ${otherUsername}`
    )

    bot.sendMessage(
        otherChatID,
        `🎉 Это мэтч!\n\n❤️ Вы понравились друг другу!\n\nTelegram пользователя: ${currentUsername}`
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

        if (!user.viewed) {
            user.viewed = []
        }

        if (!user.viewed.includes(otherChatID)) {
            user.viewed.push(otherChatID)
        }

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

        bot.sendMessage(chatID, '❤️ Лайк отправлен! Ждём ответа.')

        bot.sendMessage(
            chatID,
            '❤️ Лайк отправлен! Ждём ответа.'
        )

        if (!likedUser.likedBy.includes(chatID)) {
            likedUser.likedBy.push(chatID)
        }

        bot.sendMessage(
            otherChatID,
            `❤️ Ваша анкета понравилась пользователю ${user.name}!\n\nПосмотрите его анкету и решите, хотите ли вы ответить взаимностью.`).then(() => {
            sendLikeBackProfile(otherChatID, chatID)
        }).catch(error => {
            console.error('Не удалось отправить уведомление о лайке:', error.message)
        })

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