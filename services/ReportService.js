class ReportService {
    constructor(reportRepository) {
        this.reportRepository = reportRepository
    }

    async createReport(
        reporterChatID,
        reportedChatID,
        reason,
        reporterUsername = null,
        reportedUsername = null
    ) {
        if (!reporterChatID || !reportedChatID) {
            return {
                success: false,
                message: 'Не найдено анкеты для жалобы.'
            }
        }

        if (Number(reporterChatID) === Number(reportedChatID)) {
            return {
                success: false,
                message: 'Нельзя пожаловаться на собственную анкету.'
            }
        }

        const text = String(reason ?? '').trim()
        if (!text) {
            return {
                success: false,
                message: '❌ Причина не может быть пустой. Напишите, что именно нарушает анкета.'
            }
        }

        if (text.length > 2000) {
            return {
                success: false,
                message: '❌ Причина слишком длинная. Максимальная длина — 2000 символов.'
            }
        }

        try {
            const report = await this.reportRepository.create({
                reporterChatID,
                reportedChatID,
                reason: text
            })

            console.log(
                `[Репорт] от @${reporterUsername || reporterChatID} на @${reportedUsername || reportedChatID}: ${text.slice(0, 120)}`
            )

            return { success: true, report }
        } catch (error) {
            console.error('Ошибка сохранения репорта:', error.message)
            return {
                success: false,
                message: '❌ Не удалось сохранить жалобу. Попробуйте ещё раз.'
            }
        }
    }

    async getReport(reportID) {
        const id = Number(reportID)

        if (!Number.isInteger(id)) {
            return null
        }

        return this.reportRepository.findById(id)
    }

    async setStatus(reportID, status) {
        if (!['new', 'processed', 'dismissed'].includes(status)) {
            return { success: false }
        }

        const id = Number(reportID)
        if (!Number.isInteger(id)) {
            return { success: false }
        }

        const report = await this.reportRepository.setStatus(id, status)

        if (!report) {
            return { success: false }
        }

        return { success: true, report }
    }
}

module.exports = ReportService