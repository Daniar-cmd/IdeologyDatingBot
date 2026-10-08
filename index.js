require('dotenv').config()

const TelegramApi = require('node-telegram-bot-api')
const token = process.env.BOT_TOKEN
const bot = new TelegramApi(token, { polling: true })

const inviteCode = 'YABLOKO'
const users = {}

bot.on('message', msg => {
    const chatID = msg.chat.id
    const text = msg.text

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
    if (users[chatID]?.waitingForInvite) {
        if (text === inviteCode) {
            users[chatID].registered = true
            users[chatID].waitingForInvite = false
            bot.sendMessage(
                chatID,
                '✅ Инвайт-код принят! Вы успешно вошли в систему.'
            )
            return
        }
        bot.sendMessage(
            chatID,
            '❌ Неверный инвайт-код. Попробуйте ещё раз.'
        )
    }
})