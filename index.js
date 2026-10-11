require('dotenv').config()

const Bot = require('./bot')

const bot = new Bot()

bot.start().catch(error => {
    console.error('Не удалось запустить приложение:', error)
})