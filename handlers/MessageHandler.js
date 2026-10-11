class MessageHandler {
    constructor(bot, users, registrationService, profileService, matchingService, likeService) {
        this.bot = bot;
        this.users = users;
        this.registrationService = registrationService;
        this.profileService = profileService;
        this.matchingService = matchingService;
        this.likeService = likeService;
    }

    async sendDatingProfile(chatID, otherChatID) {
        const user = this.users[otherChatID];

        if (!user || !user.photos || user.photos.length === 0) {
            await this.bot.sendMessage(chatID, '❌ Не удалось загрузить анкету. Попробуйте позже.');
            return;
        }

        const profileText = `👤 ${user.name}, ${user.age}
🌍 ${user.city}

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
🌍 ${user.city}

${user.description || ''}`;

        try {
            if (user.photos.length === 1) {
                await this.bot.sendPhoto(chatID, user.photos[0], {
                    caption: profileText
                });
                return;
            }

            const media = user.photos.map((photo, index) => ({
                type: 'photo',
                media: photo,
                ...(index === 0 ? { caption: profileText } : {})
            }));

            await this.bot.sendMediaGroup(chatID, media);
        } catch (error) {
            console.error('Ошибка показа собственной анкеты:', error.message);
            await this.bot.sendMessage(chatID, '❌ Не удалось показать анкету. Попробуйте позже.');
        }
    }

    async sendLikeBackProfile(chatID, otherChatID) {
        const user = this.users[otherChatID];

        if (!user || !user.photos || user.photos.length === 0) {
            await this.bot.sendMessage(chatID, 'Не удалось загрузить анкету пользователя.');
            return;
        }

        const profileText = `❤️ Этот человек поставил вам лайк!

👤 ${user.name}, ${user.age}
🌍 ${user.city}

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
                        '✅ Возраст сохранён.\n\n📝 Расскажите немного о себе.\n\nОписание необязательно. Максимальная длина — 400 символов.',
                        {
                            reply_markup: {
                                keyboard: [['Пропустить']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        }
                    );
                    return;
                }

                if (user.waitingForDescription) {
                    const result = this.registrationService.setDescription(chatID, text);

                    if (!result.success) {
                        await this.bot.sendMessage(
                            chatID,
                            result.message || 'Не удалось сохранить описание. Попробуйте ещё раз.'
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Описание сохранено.\n\n🌍 В каком городе вы живёте?',
                        { reply_markup: { remove_keyboard: true } }
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

                    await this.bot.sendMessage(
                        chatID,
                        '✅ Город сохранён.\n\n📸 Теперь отправьте от 1 до 5 фотографий для вашей анкеты.',
                        { reply_markup: { remove_keyboard: true } }
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
                            '🎉 Поздравляем! Анкета успешно создана.\n\nЧтобы посмотреть её, используйте команду /profile.',
                            { reply_markup: { remove_keyboard: true } }
                        );
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
                    const result = this.registrationService.addPhoto(chatID, photo);

                    if (!result.success) {
                        await this.bot.sendMessage(chatID, result.message);
                        return;
                    }

                    if (result.completed) {
                        await this.bot.sendMessage(
                            chatID,
                            '🎉 Поздравляем! Анкета успешно создана.\n\nЧтобы посмотреть её, используйте команду /profile.',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        return;
                    }

                    await this.bot.sendMessage(
                        chatID,
                        `✅ Фото добавлено. Сейчас загружено: ${result.user.photos.length}/5.\n\nМожете отправить ещё фотографии или нажать «Готово».`,
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

                if (text === '/profile') {
                    if (!this.profileService.isProfileComplete(chatID)) {
                        await this.bot.sendMessage(chatID, '❌ Вы ещё не завершили создание анкеты.');
                        return;
                    }

                    await this.sendProfile(chatID, this.profileService.getProfile(chatID));
                    return;
                }

                if (text === '/lenta') {
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
🌍 ${user.city}

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