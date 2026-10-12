const ReportService = require('../services/ReportService')
const ImageModerationService = require('../services/ImageModerationService')

class MessageHandler {
    constructor(bot, users, registrationService, profileService, matchingService, likeService, cityService, reportService, moderatorChatIDs = [], moderatorService = null, imageModerationService = null, userRepository = null) {
        this.bot = bot;
        this.users = users;
        this.registrationService = registrationService;
        this.profileService = profileService;
        this.matchingService = matchingService;
        this.likeService = likeService;
        this.cityService = cityService;
        this.reportService = reportService;
        this.moderatorChatIDs = moderatorChatIDs;
        this.moderatorService = moderatorService;
        this.imageModerationService = imageModerationService || new ImageModerationService(bot);
        this.userRepository = userRepository;

        // Состояние разбора жалобы в чате модератора:
        // { step, reportID, action, reason, attempts, deadline, timer }
        this.moderationStates = {};

        // Время на весь разбор жалобы: от ввода ключа 1 до финального решения
        this.moderationTimeoutMs = 90 * 1000;
        // Попыток на ввод каждого admin-ключа
        this.maxKeyAttempts = 3;

        this.adminPin1 = String(process.env.ADMIN_PIN_KEY1 || '285868').trim();
        this.adminPin2 = String(process.env.ADMIN_PIN_KEY2 || '188467').trim();
    }

    isModeratorChat(chatID) {
        return this.moderatorChatIDs.includes(Number(chatID));
    }

    // Удаляет сообщение модератора с admin-ключом, чтобы ключ не оставался в чате
    async deleteModeratorKeyMessage(chatID, messageID) {
        if (!messageID) {
            return;
        }

        await this.bot.deleteMessage(chatID, messageID).catch(() => {});
    }

    async getModeratorFreezeUntil(chatID) {
        if (!this.moderatorService) {
            return null;
        }

        return this.moderatorService.getFreezeUntil(chatID);
    }

    async freezeModerator(chatID) {
        if (!this.moderatorService) {
            return null;
        }

        return this.moderatorService.freeze(chatID);
    }

    // Останавливает таймер и стирает состояние разбора
    endModeration(chatID) {
        const state = this.moderationStates[chatID];

        if (state && state.timer) {
            clearTimeout(state.timer);
        }

        delete this.moderationStates[chatID];
    }

    // Запускает 90-секундный таймер на завершение разбора
    startModerationTimer(chatID) {
        const state = this.moderationStates[chatID];

        if (!state) {
            return;
        }

        if (state.timer) {
            clearTimeout(state.timer);
        }

        state.deadline = Date.now() + this.moderationTimeoutMs;
        state.timer = setTimeout(() => {
            this.expireModeration(chatID);
        }, this.moderationTimeoutMs);
    }

    // Если время вышло — разбор прерывается автоматически (отменить вручную нельзя)
    async expireModeration(chatID) {
        const state = this.moderationStates[chatID];

        if (!state) {
            return;
        }

        this.endModeration(chatID);

        await this.bot.sendMessage(
            chatID,
            '⏰ Время на разбор (90 секунд) истекло, решение не принято.\n\nНажмите «👁 Посмотреть» в уведомлении, чтобы начать заново.'
        ).catch(() => {});
    }

    // Модератор исчерпал попытки ввода ключа — заморозка на 24 часа
    async lockoutModerator(chatID, keyNumber) {
        this.endModeration(chatID);

        const until = await this.freezeModerator(chatID);
        const untilText = until ? ` до ${until.toLocaleString('ru-RU')}` : '';

        await this.bot.sendMessage(
            chatID,
            `🚫 Неверный admin pin ключ ${keyNumber} введён ${this.maxKeyAttempts} раза. Аккаунт модератора заморожен на 24 часа${untilText}.`
        ).catch(() => {});
    }

    async sendReportNotification(modChatID, report, reportedUser, reporterUser) {
        const reporterName = reporterUser
            ? `@${reporterUser.username || reporterUser.chatID} (${reporterUser.name || reporterUser.chatID})`
            : `ID ${report.reporter_chat_id}`;
        const reportedName = reportedUser
            ? `@${reportedUser.username || reportedUser.chatID} (${reportedUser.name || reportedUser.chatID})`
            : `ID ${report.reported_chat_id}`;

        const text = `🚩 Пользователь ${reporterName} пожаловался на пользователя ${reportedName}.

Причина: ${report.reason}`;

        try {
            await this.bot.sendMessage(modChatID, text, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '👁 Посмотреть', callback_data: `report_view_${report.id}` }
                    ]]
                }
            });
            console.log(`[Репорт] уведомление о репорте #${report.id} отправлено модератору ${modChatID}`);
        } catch (error) {
            console.error(`Не удалось отправить уведомление о жалобе #${report.id} модератору ${modChatID}:`, error.message);
        }
    }

    async sendModerationProfile(chatID, user, reportID) {
        const profileText = `🚩 Анкета, на которую пожаловались:

👤 ${user.name}, ${user.age}
${this.formatLocation(user)}
@${user.username || user.chatID} (ID ${user.chatID})

${user.description || ''}`;

        const buttons = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⛔ Забанить', callback_data: `report_mod_ban_${reportID}` }],
                    [{ text: '⚠️ Варн', callback_data: `report_mod_warn_${reportID}` }],
                    [{ text: '✅ Ложное срабатывание', callback_data: `report_mod_dismiss_${reportID}` }]
                ]
            }
        };

        try {
            if (user.photos && user.photos.length > 0) {
                await this.bot.sendPhoto(chatID, user.photos[0], {
                    caption: profileText,
                    ...buttons
                });
                return;
            }

            await this.bot.sendMessage(chatID, profileText, buttons);
        } catch (error) {
            console.error('Ошибка показа анкеты модератору:', error.message);
        }
    }

    // Возвращает true, если сообщение обработано как часть разбора жалобы
    async handleModerationText(chatID, text, messageID = null) {
        const state = this.moderationStates[chatID];

        if (!state) {
            return false;
        }

        // Разбор нельзя отменить вручную; прерывается только по таймауту
        if (state.deadline && Date.now() > state.deadline) {
            await this.expireModeration(chatID);
            return true;
        }

        if (state.step === 'pin1') {
            if (!text) {
                await this.bot.sendMessage(chatID, '❌ Введите pin ключ текстом.');
                return true;
            }

            if (text.trim().startsWith('/')) {
                await this.bot.sendMessage(
                    chatID,
                    '⛔ Отмена недоступна — разбор нужно довести до конца.\n\n🔐 Введите admin pin ключ 1:'
                );
                return true;
            }

            if (text.trim() !== this.adminPin1) {
                state.attempts = (state.attempts || 0) + 1;

                if (state.attempts >= this.maxKeyAttempts) {
                    await this.lockoutModerator(chatID, 1);
                    return true;
                }

                await this.bot.sendMessage(
                    chatID,
                    `❌ Неверный admin pin ключ 1. Осталось попыток: ${this.maxKeyAttempts - state.attempts}.`
                );
                return true;
            }

            // Ключ принят — сразу удаляем сообщение с ним
            await this.deleteModeratorKeyMessage(chatID, messageID);

            const report = await this.reportService.getReport(state.reportID);
            const reportedUser = report ? this.users[Number(report.reported_chat_id)] : null;

            if (!report || report.status !== 'new' || !reportedUser) {
                this.endModeration(chatID);
                await this.bot.sendMessage(chatID, '❌ Жалоба больше недоступна для обработки.');
                return true;
            }

            // Ключ 1 принят — с этого момента идёт отсчёт 90 секунд до финального решения
            state.step = 'action';
            state.action = null;
            state.reason = null;
            state.attempts = 0;
            this.startModerationTimer(chatID);

            await this.sendModerationProfile(chatID, reportedUser, report.id);
            return true;
        }

        if (state.step === 'action') {
            await this.bot.sendMessage(chatID, '👆 Нажмите одну из кнопок под анкетой.');
            return true;
        }

        if (state.step === 'reason') {
            if (!text || !text.trim() || text.trim().startsWith('/')) {
                await this.bot.sendMessage(chatID, '✍️ Напишите причину текстом.');
                return true;
            }

            state.reason = text.trim().slice(0, 500);
            state.step = 'pin2';
            state.attempts = 0;

            await this.bot.sendMessage(chatID, '🔐 Введите admin pin ключ 2 для подтверждения решения:');
            return true;
        }

        if (state.step === 'pin2') {
            if (!text) {
                await this.bot.sendMessage(chatID, '❌ Введите pin ключ текстом.');
                return true;
            }

            if (text.trim().startsWith('/')) {
                await this.bot.sendMessage(
                    chatID,
                    '⛔ Отмена недоступна — разбор нужно довести до конца.\n\n🔐 Введите admin pin ключ 2:'
                );
                return true;
            }

            if (text.trim() !== this.adminPin2) {
                state.attempts = (state.attempts || 0) + 1;

                if (state.attempts >= this.maxKeyAttempts) {
                    await this.lockoutModerator(chatID, 2);
                    return true;
                }

                await this.bot.sendMessage(
                    chatID,
                    `❌ Неверный admin pin ключ 2. Осталось попыток: ${this.maxKeyAttempts - state.attempts}.`
                );
                return true;
            }

            // Ключ принят — сразу удаляем сообщение с ним
            await this.deleteModeratorKeyMessage(chatID, messageID);

            await this.applyModerationVerdict(chatID);
            return true;
        }

        return true;
    }

    async applyModerationVerdict(chatID) {
        const state = this.moderationStates[chatID];

        if (!state) {
            return;
        }

        const report = await this.reportService.getReport(state.reportID);

        if (!report) {
            this.endModeration(chatID);
            await this.bot.sendMessage(chatID, '❌ Жалоба не найдена.');
            return;
        }

        if (report.status !== 'new') {
            this.endModeration(chatID);
            await this.bot.sendMessage(chatID, '❌ Жалоба уже обработана другим модератором.');
            return;
        }

        const targetChatID = Number(report.reported_chat_id);
        const targetUser = this.users[targetChatID];

        if (!targetUser) {
            this.endModeration(chatID);
            await this.bot.sendMessage(chatID, '❌ Пользователь не найден.');
            return;
        }

        if (state.action === 'ban') {
            targetUser.applyBan();
            targetUser.bannedUntil = null;
            targetUser.bannedAt = new Date();
            targetUser.bannedBy = state.moderatorName || null;
            targetUser.banReason = state.reason || null;
            await this.persistModeration(targetUser);
            await this.reportService.setStatus(report.id, 'processed', {
                resolvedBy: state.moderatorName,
                resolvedAction: 'ban',
                resolvedReason: state.reason
            });

            await this.bot.sendMessage(
                targetChatID,
                `⛔ Вы были забанены.\n\nПричина: ${state.reason || 'не указана'}`
            ).catch(() => {});

            await this.bot.sendMessage(chatID, '✅ Решение применено: пользователь забанен.');
        } else if (state.action === 'warn') {
            const result = targetUser.applyWarning();

            if (targetUser.banned) {
                targetUser.bannedUntil = null;
                targetUser.bannedAt = targetUser.bannedAt || new Date();
                targetUser.bannedBy = targetUser.bannedBy || state.moderatorName || null;
                targetUser.banReason = targetUser.banReason || state.reason || null;
            }

            await this.persistModeration(targetUser);
            await this.reportService.setStatus(report.id, 'processed', {
                resolvedBy: state.moderatorName,
                resolvedAction: 'warn',
                resolvedReason: state.reason
            });

            await this.bot.sendMessage(
                targetChatID,
                `⚠️ Вы получили предупреждение.\n\nПричина: ${state.reason || 'не указана'}`
            ).catch(() => {});

            if (result.banned) {
                await this.bot.sendMessage(
                    targetChatID,
                    '⛔ Вы набрали 3 предупреждения — доступ к боту закрыт. Вы забанены.'
                ).catch(() => {});
                await this.bot.sendMessage(chatID, `✅ Решение применено: предупреждение ${result.warnings}/3. Пользователь забанен.`);
            } else {
                await this.bot.sendMessage(chatID, `✅ Решение применено: предупреждение ${result.warnings}/3.`);
            }
        } else if (state.action === 'dismiss') {
            await this.reportService.setStatus(report.id, 'dismissed', {
                resolvedBy: state.moderatorName,
                resolvedAction: 'dismiss'
            });
            await this.bot.sendMessage(chatID, '✅ Жалоба отклонена как ложное срабатывание.');
        } else {
            this.endModeration(chatID);
            await this.bot.sendMessage(chatID, '❌ Неизвестное действие.');
            return;
        }

        this.endModeration(chatID);
    }

    // Сохраняет состояние модерации пользователя в БД. Нужно, потому что
    // общее автосохранение анкет намеренно не трогает поля banned/warnings/banned_until.
    async persistModeration(user) {
        if (!this.userRepository || typeof this.userRepository.setModerationState !== 'function') {
            return;
        }

        await this.userRepository.setModerationState(user.chatID, {
            banned: user.banned,
            warnings: user.warnings,
            bannedUntil: user.bannedUntil || null,
            bannedAt: user.bannedAt || null,
            bannedBy: user.bannedBy || null,
            banReason: user.banReason || null
        }).catch(error => {
            console.error('Ошибка сохранения состояния модерации:', error.message);
        });
    }

    formatLocation(user) {
        if (user.isGlobal) {
            return `🌍 ${this.cityService.globalCity}`;
        }

        return `🏠 ${user.city}`;
    }

    buildProfileMenu(user) {
        const toggleSearchButton = user.hidden
            ? { text: '👁 Вернуться в поиск', callback_data: 'menu_show' }
            : { text: '🙈 Скрыть из поиска', callback_data: 'menu_hide' };

        return {
            inline_keyboard: [
                [{ text: '🔎 Смотреть дальше', callback_data: 'menu_lenta' }],
                [{ text: '♻️ Заполнить заново', callback_data: 'menu_restart' }],
                [{ text: '📷 Изменить фото', callback_data: 'menu_photos' }],
                [{ text: '✏️ Изменить описание', callback_data: 'menu_description' }],
                [toggleSearchButton]
            ]
        };
    }

    photoPromptOptions(user) {
        if (user.previousPhotos && user.previousPhotos.length > 0) {
            return {
                reply_markup: {
                    keyboard: [['Оставить прежнее']],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };
        }

        return { reply_markup: { remove_keyboard: true } };
    }

    imageModerationRejectMessage(reason) {
        if (reason === 'qr') {
            return '❌ Фото содержит QR-код. Пожалуйста, загрузите фото без QR-кода.';
        }

        return '❌ Фото содержит неприемлемый контент. Пожалуйста, загрузите другое фото.';
    }

    async startDating(chatID) {
        if (!this.profileService.isProfileComplete(chatID)) {
            await this.bot.sendMessage(chatID, '❌ Сначала необходимо завершить создание анкеты.');
            return;
        }

        const match = this.matchingService.findMatch(chatID);

        if (!match) {
            await this.bot.sendMessage(chatID, '😔 Пока не найдено подходящих анкет.');
            return;
        }

        await this.sendDatingProfile(chatID, match.chatID);
    }

    async sendDatingProfile(chatID, otherChatID) {
        const user = this.users[otherChatID];

        const viewer = this.users[chatID];
        if (viewer) {
            viewer.lastShownProfileID = otherChatID;
        }

        if (!user || !user.photos || user.photos.length === 0) {
            await this.bot.sendMessage(chatID, '❌ Не удалось загрузить анкету. Попробуйте позже.');
            return;
        }

        const profileText = `👤 ${user.name}, ${user.age}
${this.formatLocation(user)}

${user.description || ''}`;

        try {
            if (user.photos.length === 1) {
                await this.bot.sendPhoto(chatID, user.photos[0], {
                    caption: profileText,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '❤️', callback_data: `like_${otherChatID}` },
                            { text: '❌', callback_data: `skip_${otherChatID}` }
                        ]]
                    }
                });
                return;
            }

            const media = user.photos.map((photo, index) => ({
                type: 'photo',
                media: photo,
                ...(index === 0 ? { caption: profileText } : {})
            }));

            const sentMessages = await this.bot.sendMediaGroup(chatID, media);
            const lastMessage = sentMessages[sentMessages.length - 1];

            await this.bot.sendMessage(chatID, 'Выберите действие:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❤️', callback_data: `like_${otherChatID}` },
                        { text: '❌', callback_data: `skip_${otherChatID}` }
                    ]]
                },
                reply_to_message_id: lastMessage.message_id
            });
        } catch (error) {
            console.error('Ошибка отправки анкеты:', error.message);
            await this.bot.sendMessage(chatID, '❌ Не удалось отправить анкету. Попробуйте позже.');
        }
    }

    async sendProfile(chatID, user) {
        if (!user || !user.photos || user.photos.length === 0) {
            await this.bot.sendMessage(chatID, '❌ В анкете нет фотографий.');
            return;
        }

        const profileText = `👤 ${user.name}, ${user.age}
${this.formatLocation(user)}

${user.description || ''}`;

        try {
            if (user.photos.length === 1) {
                await this.bot.sendPhoto(chatID, user.photos[0], {
                    caption: profileText,
                    reply_markup: this.buildProfileMenu(user)
                });
                return;
            }

            const media = user.photos.map((photo, index) => ({
                type: 'photo',
                media: photo,
                ...(index === 0 ? { caption: profileText } : {})
            }));

            const sentMessages = await this.bot.sendMediaGroup(chatID, media);
            const lastMessage = sentMessages[sentMessages.length - 1];

            await this.bot.sendMessage(chatID, 'Управление анкетой:', {
                reply_markup: this.buildProfileMenu(user),
                reply_to_message_id: lastMessage.message_id
            });
        } catch (error) {
            console.error('Ошибка показа собственной анкеты:', error.message);
            await this.bot.sendMessage(chatID, '❌ Не удалось показать анкету. Попробуйте позже.');
        }
    }

    async sendLikeBackProfile(chatID, otherChatID) {
        const user = this.users[otherChatID];

        const viewer = this.users[chatID];
        if (viewer) {
            viewer.lastShownProfileID = otherChatID;
        }

        if (!user || !user.photos || user.photos.length === 0) {
            await this.bot.sendMessage(chatID, 'Не удалось загрузить анкету пользователя.');
            return;
        }

        const profileText = `❤️ Этот человек поставил вам лайк!

👤 ${user.name}, ${user.age}
${this.formatLocation(user)}

${user.description || ''}

Симпатия взаимна?`;

        await this.bot.sendPhoto(chatID, user.photos[0], {
            caption: profileText,
            reply_markup: {
                inline_keyboard: [[
                    { text: '❤️ Лайкнуть в ответ', callback_data: `match_${otherChatID}` },
                    { text: '❌', callback_data: `reject_${otherChatID}` }
                ]]
            }
        });
    }

    register() {
        this.bot.on('message', async (msg) => {
            const chatID = msg.chat.id;
            const text = msg.text;
            let user = this.users[chatID];

            try {
                // Шаги модерации (pin / причина) обрабатываются раньше всего
                if (this.isModeratorChat(chatID)) {
                    const consumed = await this.handleModerationText(chatID, text, msg.message_id);

                    if (consumed) {
                        return;
                    }
                }

                // Сообщения забаненных пользователей не принимаются
                if (user?.banned) {
                    return;
                }

                if (user?.waitingForAge &&
                    (text === '👨 Мужской' || text === '👩 Женский')) {
                    await this.bot.sendMessage(chatID, '❌ Сейчас нужно ввести возраст числом.');
                    return;
                }

                if (text === '/start') {
                    this.registrationService.startRegistration(
                        chatID,
                        msg.from.username || null
                    );

                    await this.bot.sendMessage(
                        chatID,
                        'Привет! Это IdeologyDatingBot. Здесь ты сможешь найти друзей или вторую половинку на основании общих взглядов, ценностей и мировоззрения.\n\nВведите инвайт-код для входа в систему:'
                    );
                    return;
                }

                if (!user) {
                    user = this.registrationService.getOrCreateUser(
                        chatID,
                        msg.from.username || null
                    );
                }

                user.username = msg.from.username || null;

                if (user.reportReasonPending) {
                    if (!text) {
                        await this.bot.sendMessage(
                            chatID,
                            '❌ Пожалуйста, напишите причину текстом.'
                        );
                        return;
                    }

                    if (text.startsWith('/')) {
                        await this.bot.sendMessage(
                            chatID,
                            '❌ Это команда, а не причина.\n\nНапишите текстом, что именно нарушает анкета.'
                        );
                        return;
                    }

                    const targetChatID = user.lastShownProfileID;
                    const targetUser = this.users[targetChatID];

                    const result = await this.reportService.createReport(
                        chatID,
                        targetChatID,
                        text,
                        user.username || null,
                        targetUser?.username || null
                    );

                    user.reportReasonPending = false;

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Жалоба отправлена. Спасибо, мы рассмотрим её.',
                        {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🔎 Продолжить просмотр анкет', callback_data: 'menu_lenta' }
                                ]]
                            }
                        }
                    );

                    if (result.report) {
                        const reporterUser = this.users[chatID];
                        const reportedUser = this.users[targetChatID];
                        let sent = 0, skippedFrozen = 0;

                        for (const modChatID of this.moderatorChatIDs) {
                            const freezeUntil = await this.getModeratorFreezeUntil(modChatID);
                            if (freezeUntil) {
                                skippedFrozen++;
                                continue;
                            }

                            await this.sendReportNotification(modChatID, result.report, reportedUser, reporterUser);
                            sent++;
                        }
                        console.log(`[Репорт] #${result.report.id}: уведомлено модераторов=${sent}, пропущено (заморозка)=${skippedFrozen}, всего получателей=${this.moderatorChatIDs.length}`);
                    }
                    return;
                }

                if (user.waitingForEditDescription) {
                    if (text === 'Оставить как есть') {
                        this.registrationService.cancelDescriptionEdit(chatID);
                        await this.bot.sendMessage(
                            chatID,
                            '✅ Описание осталось прежним.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    if (text && text.startsWith('/')) {
                        await this.bot.sendMessage(
                            chatID,
                            '❌ Это команда, а не описание.\n\nОтправьте текст описания или нажмите «Оставить как есть».'
                        );
                        return;
                    }

                    const result = this.registrationService.updateDescription(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить описание. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Описание обновлено.',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    await this.sendProfile(chatID, user);
                    return;
                }

                if (user.waitingForEditPhotos) {
                    if (text === 'Оставить как есть') {
                        this.registrationService.cancelPhotoEdit(chatID);
                        await this.bot.sendMessage(
                            chatID,
                            '✅ Фотографии остались прежними.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    if (text === 'Готово') {
                        const result = this.registrationService.finishPhotoEdit(chatID);

                        if (!result.success) {
                            await this.bot.sendMessage(chatID, result.message);
                            return;
                        }

                        await this.bot.sendMessage(
                            chatID,
                            '✅ Фотографии обновлены.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    if (!msg.photo || msg.photo.length === 0) {
                        await this.bot.sendMessage(
                            chatID,
                            '❌ Отправьте фотографию или нажмите «Оставить как есть».'
                        );
                        return;
                    }

                    const photo = msg.photo[msg.photo.length - 1].file_id;

                    const moderation = await this.imageModerationService.moderateFile(photo);

                    if (!moderation.ok) {
                        await this.bot.sendMessage(chatID, this.imageModerationRejectMessage(moderation.reason));
                        return;
                    }

                    const result = this.registrationService.addEditPhoto(chatID, photo);

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    if (result.completed) {
                        await this.bot.sendMessage(
                            chatID,
                            '✅ Фотографии обновлены.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        `✅ Фото добавлено. Сейчас загружено: ${result.user.editPhotos.length}/3.\n\nОтправьте ещё фотографии или нажмите «Готово».`,
                        {
                            reply_markup: {
                                keyboard: [['Оставить как есть'], ['Готово']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (user.waitingForInvite) {
                    const result = this.registrationService.validateInvite(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Инвайт-код принят! Вы успешно вошли в систему.\n\n👤 Давайте создадим ваш профиль.\n\nКак вас зовут?'
                    );
                    return;
                }

                if (user.waitingForName) {
                    const result = this.registrationService.setName(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || '❌ Не удалось сохранить имя. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        `Отлично, ${result.user.name}! Ваше имя сохранено.\n\nТеперь выберите ваш пол:`,
                        {
                            reply_markup: {
                                keyboard: [['👨 Мужской', '👩 Женский']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (user.waitingForGender) {
                    const result = this.registrationService.setGender(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить пол. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Пол сохранён.\n\n🎂 Сколько вам лет?\n\nМинимальный возраст для регистрации — 16 лет.\n\n⚠️ Пожалуйста, указывайте реальный возраст. Подделка возраста недопустима.',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    return;
                }

                if (user.waitingForAge) {
                    const result = this.registrationService.setAge(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить возраст. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Возраст сохранён.\n\n🌍 В каком городе вы живёте?\n\nВведите название города или выберите «🌍 Глобал», чтобы искать по всему миру. Глобальные пользователи видят анкеты из всех городов, и их видят все.',
                        {
                            reply_markup: {
                                keyboard: [[this.cityService.globalLabel]],
                                resize_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (user.waitingForDescription) {
                    const result = text === 'Оставить прежнее'
                        ? this.registrationService.keepPreviousDescription(chatID)
                        : this.registrationService.setDescription(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить описание. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Описание сохранено.\n\n📸 Теперь отправьте от 1 до 3 фотографий для вашей анкеты.',
                        this.photoPromptOptions(result.user)
                    );
                    return;
                }

                if (user.waitingForCity) {
                    const result = this.registrationService.setCity(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить город. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    const descriptionKeyboard = result.user.previousDescription
                        ? [['Оставить прежнее'], ['Пропустить']]
                        : [['Пропустить']];

                    if (result.user.isGlobal) {
                        await this.bot.sendMessage(
                            chatID,
                            '✅ Вы выбрали «🌍 Глобал» — вам будут показываться анкеты со всего мира.\n\n📝 Расскажите немного о себе.\n\nОписание необязательно. Максимальная длина — 400 символов.',
                            {
                                reply_markup: {
                                    keyboard: descriptionKeyboard,
                                    resize_keyboard: true,
                                    one_time_keyboard: true
                                }
                            }
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Город сохранён.\n\n📝 Расскажите немного о себе.\n\nОписание необязательно. Максимальная длина — 400 символов.',
                        {
                            reply_markup: {
                                keyboard: descriptionKeyboard,
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (user.waitingForPhotos) {
                    if (text === 'Готово') {
                        const result = this.registrationService.finishPhotos(chatID);

                        if (!result.success) {
                            await this.bot.sendMessage(chatID, result.message);
                            return;
                        }

                        await this.bot.sendMessage(
                            chatID,
                            '🎉 Поздравляем! Ваша анкета успешно создана.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    if (text === 'Оставить прежнее') {
                        const result = this.registrationService.keepPreviousPhotos(chatID);

                        if (!result.success) {
                            await this.bot.sendMessage(chatID, result.message);
                            return;
                        }

                        await this.bot.sendMessage(
                            chatID,
                            '🎉 Поздравляем! Ваша анкета успешно создана.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    if (!msg.photo || msg.photo.length === 0) {
                        await this.bot.sendMessage(
                            chatID,
                            '❌ Пожалуйста, отправьте фотографию или нажмите «Готово».'
                        );
                        return;
                    }

                    const photo = msg.photo[msg.photo.length - 1].file_id;

                    const moderation = await this.imageModerationService.moderateFile(photo);

                    if (!moderation.ok) {
                        await this.bot.sendMessage(chatID, this.imageModerationRejectMessage(moderation.reason));
                        return;
                    }

                    const result = this.registrationService.addPhoto(chatID, photo);

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    if (result.completed) {
                        await this.bot.sendMessage(
                            chatID,
                            '🎉 Поздравляем! Ваша анкета успешно создана.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        await this.sendProfile(chatID, user);
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        `✅ Фото добавлено. Сейчас загружено: ${result.user.photos.length}/3.\n\nМожете отправить ещё фотографии или нажать «Готово».`,
                        {
                            reply_markup: {
                                keyboard: [['Готово']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (text === '/report') {
                    if (!this.reportService) {
                        await this.bot.sendMessage(chatID, '🚧 Жалобы пока не доступны. Попробуйте позже.');
                        return;
                    }

                    if (!this.profileService.isProfileComplete(chatID)) {
                        await this.bot.sendMessage(chatID, '❌ Сначала необходимо завершить создание анкеты.');
                        return;
                    }

                    const targetChatID = user.lastShownProfileID;

                    if (!targetChatID || !this.users[targetChatID]) {
                        await this.bot.sendMessage(
                            chatID,
                            '🚫 Не найдено анкеты для жалобы.\n\nСначала посмотрите анкету в ленте — /lenta.'
                        );
                        return;
                    }

                    user.reportReasonPending = true;

                    await this.bot.sendMessage(
                        chatID,
                        '🚩 Укажите причину репорта.\n\nНапишите текстом, что именно в этой анкете нарушает правила.'
                    );
                    return;
                }

                if (text === '/myprofile') {
                    if (!this.profileService.isProfileComplete(chatID)) {
                        await this.bot.sendMessage(chatID, '❌ Вы ещё не завершили создание анкеты.');
                        return;
                    }

                    await this.sendProfile(chatID, this.profileService.getProfile(chatID));
                    return;
                }

                if (text === '/lenta') {
                    await this.startDating(chatID);
                    return;
                }
            } catch (error) {
                console.error('Ошибка обработки сообщения:', error);
                await this.bot.sendMessage(chatID, '❌ Произошла ошибка. Попробуйте ещё раз.').catch(() => {});
            }
        });

        this.bot.on('callback_query', async (query) => {
            if (!query.message) {
                await this.bot.answerCallbackQuery(query.id).catch(() => {});
                return;
            }

            const chatID = query.message.chat.id;
            const data = query.data;
            const user = this.users[chatID];

            try {
                // Забаненным пользователям кнопки недоступны
                if (user?.banned) {
                    await this.bot.answerCallbackQuery(query.id, {
                        text: '⛔ Вы забанены.'
                    }).catch(() => {});
                    return;
                }

                if (data.startsWith('viewlike_')) {
                    const otherChatID = Number(data.replace('viewlike_', ''));

                    if (!this.users[otherChatID]) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Анкета больше недоступна.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    await this.sendLikeBackProfile(chatID, otherChatID);
                    return;
                }

                if (data.startsWith('rejectlike_')) {
                    await this.bot.answerCallbackQuery(query.id, { text: 'Лайк отклонён.' });
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});
                    await this.bot.sendMessage(chatID, 'Вы отклонили лайк.');
                    return;
                }

                if (data.startsWith('report_view_')) {
                    if (!this.isModeratorChat(chatID)) {
                        await this.bot.answerCallbackQuery(query.id, { text: '⛔ Нет доступа.' });
                        return;
                    }

                    const frozenUntil = await this.getModeratorFreezeUntil(chatID);

                    if (frozenUntil) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: `🚫 Аккаунт заморожен до ${frozenUntil.toLocaleString('ru-RU')}.`
                        });
                        return;
                    }

                    const reportID = Number(data.replace('report_view_', ''));

                    if (!Number.isInteger(reportID)) {
                        await this.bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие.' });
                        return;
                    }

                    if (this.moderationStates[chatID]) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Сначала завершите текущий разбор жалобы.'
                        });
                        return;
                    }

                    const report = await this.reportService.getReport(reportID);

                    if (!report) {
                        await this.bot.answerCallbackQuery(query.id, { text: 'Жалоба не найдена.' });
                        return;
                    }

                    if (report.status !== 'new') {
                        await this.bot.answerCallbackQuery(query.id, { text: 'Жалоба уже обработана.' });
                        return;
                    }

                    const from = query.from || {};

                    this.moderationStates[chatID] = {
                        step: 'pin1',
                        reportID: report.id,
                        action: null,
                        reason: null,
                        attempts: 0,
                        deadline: null,
                        timer: null,
                        // Кто разбирает жалобу — попадёт в reports.resolved_by
                        moderatorName: from.username ? `@${from.username}` : (from.first_name || String(chatID))
                    };

                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});
                    await this.bot.answerCallbackQuery(query.id, { text: 'Введите admin pin ключ 1.' });
                    await this.bot.sendMessage(
                        chatID,
                        '🔐 Введите admin pin ключ 1 для просмотра анкеты:'
                    );
                    return;
                }

                if (data.startsWith('report_mod_')) {
                    if (!this.isModeratorChat(chatID)) {
                        await this.bot.answerCallbackQuery(query.id, { text: '⛔ Нет доступа.' });
                        return;
                    }

                    const frozenUntil = await this.getModeratorFreezeUntil(chatID);

                    if (frozenUntil) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: `🚫 Аккаунт заморожен до ${frozenUntil.toLocaleString('ru-RU')}.`
                        });
                        return;
                    }

                    const parts = data.split('_');
                    const action = parts[2];
                    const reportID = Number(parts[3]);

                    if (!['ban', 'warn', 'dismiss'].includes(action) || !Number.isInteger(reportID)) {
                        await this.bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие.' });
                        return;
                    }

                    const state = this.moderationStates[chatID];

                    if (state && state.deadline && Date.now() > state.deadline) {
                        await this.expireModeration(chatID);
                        await this.bot.answerCallbackQuery(query.id, { text: 'Время разбора истекло.' });
                        return;
                    }

                    if (!state || state.step !== 'action' || state.reportID !== reportID) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Сначала нажмите «Посмотреть» на уведомлении.'
                        });
                        return;
                    }

                    const report = await this.reportService.getReport(reportID);

                    if (!report || report.status !== 'new') {
                        this.endModeration(chatID);
                        await this.bot.answerCallbackQuery(query.id, {
                            text: report ? 'Жалоба уже обработана.' : 'Жалоба не найдена.'
                        });
                        return;
                    }

                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    if (action === 'ban' || action === 'warn') {
                        state.step = 'reason';
                        state.action = action;
                        state.attempts = 0;

                        await this.bot.answerCallbackQuery(query.id, {
                            text: action === 'ban' ? 'Укажите причину бана.' : 'Укажите причину варна.'
                        });
                        await this.bot.sendMessage(
                            chatID,
                            `✍️ Укажите текстом причину ${action === 'ban' ? 'бана' : 'предупреждения'}:`
                        );
                    } else if (action === 'dismiss') {
                        state.step = 'pin2';
                        state.action = 'dismiss';
                        state.attempts = 0;

                        await this.bot.answerCallbackQuery(query.id, { text: 'Подтвердите решение.' });
                        await this.bot.sendMessage(
                            chatID,
                            '✅ Помечено как ложное срабатывание.\n\n🔐 Введите admin pin ключ 2 для подтверждения:'
                        );
                    }
                    return;
                }

                if (data === 'menu_lenta') {
                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});
                    await this.startDating(chatID);
                    return;
                }

                if (data === 'menu_restart') {
                    const restartResult = this.registrationService.restartRegistration(chatID);

                    if (!restartResult.success) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Не удалось начать заполнение заново.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id, {
                        text: '♻️ Заполняем анкету заново.'
                    });
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    await this.bot.sendMessage(
                        chatID,
                        '♻️ Заполняем анкету заново.\n\n👤 Как вас зовут?',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    return;
                }

                if (data === 'menu_description') {
                    const editResult = this.registrationService.startDescriptionEdit(chatID);

                    if (!editResult.success) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Не удалось начать редактирование.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    await this.bot.sendMessage(
                        chatID,
                        '✏️ Отправьте новое описание.\n\nМаксимальная длина — 400 символов.',
                        {
                            reply_markup: {
                                keyboard: [['Оставить как есть'], ['Пропустить']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (data === 'menu_photos') {
                    const editResult = this.registrationService.startPhotoEdit(chatID);

                    if (!editResult.success) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Не удалось начать редактирование.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    await this.bot.sendMessage(
                        chatID,
                        '📸 Отправьте новые фотографии (от 1 до 3).\n\nНовые фотографии заменят текущие после нажатия «Готово».',
                        {
                            reply_markup: {
                                keyboard: [['Оставить как есть']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (data === 'menu_hide') {
                    const profileMessageID = query.message.message_id;

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.sendMessage(
                        chatID,
                        '🙈 Вашу анкету не будет видно, все кто поставил вам лайк — не смогут вам ответить.\n\nВы уверены, что хотите убрать анкету из поиска?',
                        {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: 'Да', callback_data: `hide_yes_${profileMessageID}` },
                                    { text: 'Нет', callback_data: `hide_no_${profileMessageID}` }
                                ]]
                            }
                        }
                    );
                    return;
                }

                if (data === 'menu_show') {
                    const profileMessageID = query.message.message_id;

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.sendMessage(
                        chatID,
                        '👁 Вы уверены, что хотите вернуть анкету в поиск?',
                        {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: 'Да', callback_data: `show_yes_${profileMessageID}` },
                                    { text: 'Нет', callback_data: `show_no_${profileMessageID}` }
                                ]]
                            }
                        }
                    );
                    return;
                }

                if (data.startsWith('hide_yes_')) {
                    const profileMessageID = Number(data.replace('hide_yes_', ''));
                    const result = this.profileService.hideFromSearch(chatID);

                    if (!result.success) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: result.message || 'Не удалось скрыть анкету.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id, { text: '🙈 Анкета скрыта.' });
                    await this.bot.deleteMessage(chatID, query.message.message_id).catch(() => {});
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: this.buildProfileMenu(result.user).inline_keyboard },
                        { chat_id: chatID, message_id: profileMessageID }
                    ).catch(() => {});
                    await this.bot.sendMessage(chatID, '🙈 Ваша анкета удалена из поиска.');
                    return;
                }

                if (data.startsWith('hide_no_')) {
                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.deleteMessage(chatID, query.message.message_id).catch(() => {});
                    return;
                }

                if (data.startsWith('show_yes_')) {
                    const profileMessageID = Number(data.replace('show_yes_', ''));
                    const result = this.profileService.returnToSearch(chatID);

                    if (!result.success) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: result.message || 'Не удалось вернуть анкету в поиск.'
                        });
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id, { text: '👁 Анкета снова в поиске.' });
                    await this.bot.deleteMessage(chatID, query.message.message_id).catch(() => {});
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: this.buildProfileMenu(result.user).inline_keyboard },
                        { chat_id: chatID, message_id: profileMessageID }
                    ).catch(() => {});
                    await this.bot.sendMessage(chatID, '👁 Ваша анкета снова в поиске.');
                    return;
                }

                if (data.startsWith('show_no_')) {
                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.deleteMessage(chatID, query.message.message_id).catch(() => {});
                    return;
                }

                if (data.startsWith('match_')) {
                    const otherChatID = Number(data.replace('match_', ''));
                    const likedUser = this.users[otherChatID];

                    if (!user || !likedUser) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: 'Анкета больше недоступна.'
                        });
                        return;
                    }

                    const result = this.likeService.createMatch(chatID, otherChatID);

                    if (!result.success) {
                        await this.bot.answerCallbackQuery(query.id, { text: result.message });
                        return;
                    }

                    if (result.alreadyMatched) {
                        await this.bot.answerCallbackQuery(query.id, {
                            text: '❤️ Мэтч уже создан.'
                        });

                        await this.bot.editMessageReplyMarkup(
                            { inline_keyboard: [] },
                            { chat_id: chatID, message_id: query.message.message_id }
                        ).catch(() => {});
                        return;
                    }

                    await this.bot.answerCallbackQuery(query.id, {
                        text: '❤️ У вас взаимная симпатия!'
                    });

                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    const currentUsername = user.username ? `@${user.username}` : 'Username не указан';
                    const otherUsername = likedUser.username ? `@${likedUser.username}` : 'Username не указан';

                    if (user.photos && user.photos.length > 0) {
                        await this.bot.sendPhoto(otherChatID, user.photos[0], {
                            caption: `👤 ${user.name}, ${user.age}
${this.formatLocation(user)}

${user.description || ''}

❤️ Этот пользователь ответил вам взаимностью!
Telegram: ${currentUsername}`
                        }).catch(error => {
                            console.error('Ошибка отправки анкеты после мэтча:', error.message);
                        });
                    }

                    await this.bot.sendMessage(
                        chatID,
                        `🎉 Это мэтч!\n\n❤️ Вы понравились друг другу!\n\nTelegram пользователя: ${otherUsername}`
                    );
                    return;
                }

                if (data.startsWith('reject_')) {
                    await this.bot.answerCallbackQuery(query.id, {
                        text: 'Вы пропустили эту анкету.'
                    });

                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    await this.bot.sendMessage(
                        chatID,
                        'Вы пропустили эту анкету. Продолжайте знакомиться в /lenta!'
                    );
                    return;
                }

                if (!user) {
                    await this.bot.answerCallbackQuery(query.id);
                    return;
                }

                if (data.startsWith('skip_')) {
                    const otherChatID = Number(data.replace('skip_', ''));

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    user.addViewed(otherChatID);

                    const nextProfile = this.matchingService.findMatch(chatID);

                    if (!nextProfile) {
                        await this.bot.sendMessage(chatID, '😔 Пока больше нет подходящих анкет.');
                        return;
                    }

                    await this.sendDatingProfile(chatID, nextProfile.chatID);
                    return;
                }

                if (data.startsWith('like_')) {
                    const otherChatID = Number(data.replace('like_', ''));
                    const likedUser = this.users[otherChatID];

                    await this.bot.answerCallbackQuery(query.id);
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [] },
                        { chat_id: chatID, message_id: query.message.message_id }
                    ).catch(() => {});

                    if (!likedUser) {
                        return;
                    }

                    const result = this.likeService.sendLike(chatID, otherChatID);

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    if (!result.alreadyLiked) {
                        await this.bot.sendMessage(chatID, '❤️ Лайк отправлен! Ждём ответа.');

                        await this.bot.sendMessage(
                            otherChatID,
                            '❤️ Вы понравились одному человеку!\n\nХотите посмотреть его анкету?',
                            {
                                reply_markup: {
                                    inline_keyboard: [[
                                        { text: '✅ Да', callback_data: `viewlike_${chatID}` },
                                        { text: '❌ Нет', callback_data: `rejectlike_${chatID}` }
                                    ]]
                                }
                            }
                        ).catch(error => {
                            console.error('Не удалось отправить уведомление о лайке:', error.message);
                        });
                    }

                    const nextProfile = this.matchingService.findMatch(chatID);

                    if (!nextProfile) {
                        await this.bot.sendMessage(chatID, '😔 Больше подходящих анкет пока нет.');
                        return;
                    }

                    await this.sendDatingProfile(chatID, nextProfile.chatID);
                }
            } catch (error) {
                console.error('Ошибка обработки нажатия:', error);
                await this.bot.answerCallbackQuery(query.id).catch(() => {});
            }
        });
    }
}

module.exports = MessageHandler;