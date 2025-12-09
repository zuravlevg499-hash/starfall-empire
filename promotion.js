const TelegramBot = require('node-telegram-bot-api');
const db = require('./database.js');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

class PromotionManager {
    constructor() {
        this.channels = {
            main: '@starfall_empire_channel',
            news: '@starfall_empire_news',
            community: '@starfall_empire_community'
        };
    }

    // Автоматическое приветствие новых участников канала
    async setupChannelWelcome() {
        bot.on('new_chat_members', async (msg) => {
            const chatId = msg.chat.id;
            const newMembers = msg.new_chat_members;
            
            for (const member of newMembers) {
                if (!member.is_bot) {
                    const welcomeMessage = `🎮 Добро пожаловать в *Starfall Empire*, ${member.first_name}!\n\n` +
                        `Присоединяйтесь к космической стратегии прямо в Telegram!\n` +
                        `🎯 Стройте станции\n` +
                        `⚔️ Сражайтесь с игроками\n` +
                        `💫 Получайте награды\n\n` +
                        `Начните игру: @starfallempire_bot`;
                    
                    await bot.sendMessage(chatId, welcomeMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🚀 НАЧАТЬ ИГРАТЬ', url: 'https://t.me/starfallempire_bot?start=welcome' }
                            ]]
                        }
                    });
                }
            }
        });
    }

    // Рассылка обновлений активным игрокам
    async sendUpdateToActivePlayers(message, daysActive = 7) {
        try {
            const activePlayers = await db.db.all(`
                SELECT DISTINCT p.telegram_id 
                FROM players p
                LEFT JOIN daily_rewards dr ON p.id = dr.player_id
                WHERE dr.created_at >= DATE('now', '-? days')
                GROUP BY p.telegram_id
                HAVING COUNT(dr.id) >= 1
            `, [daysActive]);

            let sent = 0;
            let failed = 0;

            for (const player of activePlayers) {
                try {
                    await bot.sendMessage(player.telegram_id, message, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    sent++;
                    
                    // Задержка чтобы не спамить
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.log(`Не удалось отправить игроку ${player.telegram_id}:`, error.message);
                    failed++;
                }
            }

            console.log(`✅ Рассылка завершена: ${sent} отправлено, ${failed} ошибок`);
            return { sent, failed };
        } catch (error) {
            console.error('Ошибка рассылки:', error);
            return { sent: 0, failed: 0 };
        }
    }

    // Конкурс для топ игроков
    async runWeeklyContest() {
        const topPlayers = await db.getTopPlayers(20);
        const now = new Date();
        const weekStart = new Date(now.setDate(now.getDate() - 7));
        
        let contestMessage = `🏆 *ЕЖЕНЕДЕЛЬНЫЙ КОНКУРС - Неделя ${Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7))}*\n\n`;
        
        contestMessage += `*Топ-10 игроков этой недели:*\n\n`;
        
        for (let i = 0; i < Math.min(topPlayers.length, 10); i++) {
            const player = topPlayers[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            
            contestMessage += `${medal} *${player.first_name}*\n`;
            contestMessage += `   Уровень: ${player.level} | Кристаллы: ${player.crystals}\n`;
            contestMessage += `   PvP побед: ${player.pvp_wins}\n\n`;
        }
        
        // Награды для топ-3
        contestMessage += `*Награды:*\n`;
        contestMessage += `🥇 1 место: 1000 💎 + эксклюзивный значок\n`;
        contestMessage += `🥈 2 место: 500 💎\n`;
        contestMessage += `🥉 3 место: 250 💎\n\n`;
        contestMessage += `Следующий конкурс через 7 дней!`;

        // Отправляем в канал
        await bot.sendMessage(this.channels.main, contestMessage, {
            parse_mode: 'Markdown'
        });

        // Награждаем победителей
        if (topPlayers.length >= 3) {
            await this.rewardContestWinners(topPlayers.slice(0, 3));
        }
    }

    async rewardContestWinners(winners) {
        const rewards = [1000, 500, 250];
        
        for (let i = 0; i < winners.length; i++) {
            const player = winners[i];
            const reward = rewards[i];
            
            try {
                // Добавляем кристаллы
                const currentPlayer = await db.getPlayer(player.telegram_id);
                await db.updatePlayerResources(
                    player.telegram_id,
                    currentPlayer.resources,
                    currentPlayer.crystals + reward
                );

                // Отправляем уведомление
                await bot.sendMessage(player.telegram_id,
                    `🎉 *ПОЗДРАВЛЯЕМ!*\n\n` +
                    `Вы заняли ${i + 1} место в еженедельном конкурсе!\n` +
                    `Ваша награда: *${reward} кристаллов* 💎\n\n` +
                    `Продолжайте в том же духе! 🚀`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error(`Ошибка награждения игрока ${player.telegram_id}:`, error);
            }
        }
    }

    // Система достижений
    async checkAndAwardAchievements(telegramId) {
        const player = await db.getPlayer(telegramId);
        if (!player) return;

        const achievements = [
            {
                id: 'first_1000',
                name: 'Богач',
                description: 'Накопить 1000 ресурсов',
                condition: player.resources >= 1000,
                reward: { crystals: 50 }
            },
            {
                id: 'level_10',
                name: 'Ветеран',
                description: 'Достичь 10 уровня',
                condition: player.level >= 10,
                reward: { crystals: 100, resources: 500 }
            },
            {
                id: 'pvp_king',
                name: 'Король PvP',
                description: 'Выиграть 50 PvP битв',
                condition: player.pvp_wins >= 50,
                reward: { crystals: 200 }
            },
            {
                id: 'referral_master',
                name: 'Мастер рефералов',
                description: 'Пригласить 10 друзей',
                condition: player.referrals_count >= 10,
                reward: { crystals: 300 }
            },
            {
                id: 'daily_fan',
                name: 'Преданный игрок',
                description: 'Получить 30 ежедневных наград',
                condition: player.daily_streak >= 30,
                reward: { crystals: 500 }
            }
        ];

        // Проверяем какие достижения еще не получены
        // (нужно добавить таблицу achievements в базу данных)
        const awarded = [];

        for (const achievement of achievements) {
            if (achievement.condition) {
                // Проверяем не получено ли уже достижение
                // Если не получено - награждаем
                awarded.push(achievement);
                
                // Отправляем уведомление
                await bot.sendMessage(telegramId,
                    `🎖️ *НОВОЕ ДОСТИЖЕНИЕ!*\n\n` +
                    `*${achievement.name}*\n` +
                    `${achievement.description}\n\n` +
                    `Награда: ${achievement.reward.crystals ? achievement.reward.crystals + ' 💎' : ''} ` +
                    `${achievement.reward.resources ? achievement.reward.resources + ' ⚡' : ''}\n\n` +
                    `Поздравляем!`,
                    { parse_mode: 'Markdown' }
                );

                // Добавляем награду
                await db.updatePlayerResources(
                    telegramId,
                    player.resources + (achievement.reward.resources || 0),
                    player.crystals + (achievement.reward.crystals || 0)
                );
            }
        }

        return awarded;
    }

    // Рекламная акция
    async runPromoCampaign(promoCode, discountPercent, validUntil) {
        const promoMessage = `🎁 *ПРОМО-АКЦИЯ!*\n\n` +
            `Используйте промокод *${promoCode}* и получите скидку ${discountPercent}% на все покупки Telegram Stars!\n\n` +
            `Акция действует до: ${validUntil}\n\n` +
            `Чтобы использовать промокод, просто нажмите кнопку ниже:`;

        await bot.sendMessage(this.channels.main, promoMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🚀 ИСПОЛЬЗОВАТЬ ПРОМОКОД', url: `https://t.me/starfallempire_bot?start=promo_${promoCode}` }
                ]]
            }
        });
    }
}

module.exports = new PromotionManager();