const ConsoleRegistry = require('./cli/ConsoleRegistry')

// Печатает список кастомных консольных команд, прописанных в console.txt.
function main() {
    const commands = new ConsoleRegistry().list()
    const border = '='.repeat(32)

    console.log(`\n${border}`)
    console.log('=== IdeologyDatingBot | Console ===')
    console.log(`${border}\n`)

    if (commands.length === 0) {
        console.log('Консольные команды не заданы. Добавьте их в console.txt.\n')
        return
    }

    console.log('Доступные консольные команды:\n')

    for (const { name, run, description } of commands) {
        console.log(`  ${name}`)
        console.log(`    запуск: ${run}`)

        if (description) {
            console.log(`    ${description}`)
        }

        console.log('')
    }

    console.log('Реестр команд: console.txt\n')
}

module.exports = { main }

if (require.main === module) {
    main()
}