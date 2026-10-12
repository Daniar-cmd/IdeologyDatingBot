const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const Bot = require('./bot')
const bot = new Bot()

bot.start().catch(error => {
    console.error('Не удалось запустить приложение:', error)
})