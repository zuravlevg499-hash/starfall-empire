const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const db = require('./database.js');
const promotion = require('./promotion.js');
const analytics = require('./analytics.js');

// ТВОЯ ПОСТОЯННАЯ ССЫЛКА
const WEB_APP_URL = 'https://starfall-empire.onrender.com'; // или твой домен

app.use(express.static('public'));
app.use(express.json());

// Инициализация
(async () => {
    await db.init();
    await promotion.setupChannelWelcome();
    console.log('✅ Все системы инициализированы');
})();

// ... (все предыдущие команды и API остаются)

// Новая команда /admin (только для разработчика)
bot.onText(/\/admin (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const command = match[1];
    
    // Проверяем что это разработчик
    if (userId.toString() !== process.env.TELEGRAM_USER_ID) {
        return bot.sendMessage(msg.chat.id, '⛔ Доступ запрещен');
    }
    
    try {
        switch(command) {
            case 'stats':
                const report = await analytics.generateDailyReport();
                let statsText = `📊 *АДМИН СТАТИСТИКА*\n\n`;
                statsText += `📅 Дата: ${report.date}\n\n`;
                statsText += `👥 *Игроки:*\n`;
                statsText += `Всего: ${report.players.total}\n`;
                statsText += `Новых сегодня: ${report.players.new_today}\n`;
                statsText += `Активных сегодня: ${report.players.active_today}\n\n`;
                statsText += `💰 *Доход:*\n`;
                statsText += `Stars сегодня: ${report.revenue.stars_today}\n`;
                statsText += `Покупок сегодня: ${report.revenue.purchases_today}\n`;
                statsText += `Средний чек: ${report.revenue.avg_purchase}⭐\n\n`;
                statsText += `🎮 *Игровой процесс:*\n`;
                statsText += `PvP битв: ${report.gameplay.pvp_battles_today}\n`;
                statsText += `Ежедневных наград: ${report.gameplay.daily_rewards_claimed}\n`;
                statsText += `Ресурсов собрано: ${report.gameplay.resources_collected}\n\n`;
                statsText += `📈 *Удержание:*\n`;
                statsText += `День 1: ${report.retention.day1}\n`;
                statsText += `День 7: ${report.retention.day7}\n`;
                statsText += `День 30: ${report.retention.day30}`;
                
                await bot.sendMessage(msg.chat.id, statsText, { parse_mode: 'Markdown' });
                break;
                
            case 'broadcast':
                const broadcastText = msg.text.replace('/admin broadcast ', '');
                const result = await promotion.sendUpdateToActivePlayers(broadcastText);
                await bot.sendMessage(msg.chat.id, `✅ Рассылка отправлена: ${result.sent} успешно, ${result.failed} ошибок`);
                break;
                
            case 'contest':
                await promotion.runWeeklyContest();
                await bot.sendMessage(msg.chat.id, '✅ Конкурс запущен!');
                break;
                
            case 'promo CODE 20 2024-12-31':
                const promoMatch = msg.text.match(/promo (\w+) (\d+) (.+)/);
                if (promoMatch) {
                    await promotion.runPromoCampaign(promoMatch[1], parseInt(promoMatch[2]), promoMatch[3]);
                    await bot.sendMessage(msg.chat.id, '✅ Промо-акция запущена!');
                }
                break;
                
            case 'economy':
                const balance = await analytics.getGameBalance();
                let economyText = `💰 *БАЛАНС ИГРЫ*\n\n`;
                economyText += `Игроков: ${balance.total_players}\n`;
                economyText += `Кристаллов в игре: ${balance.total_crystals_in_game} 💎\n`;
                economyText += `Куплено кристаллов: ${balance.total_purchased_crystals} 💎\n`;
                economyText += `Потрачено кристаллов: ${balance.total_crystals_spent} 💎\n`;
                economyText += `Скорость траты: ${balance.crystal_velocity}\n\n`;
                economyText += `*Анализ:* ${balance.crystal_velocity > 0.7 ? '✅ Здоровая экономика' : '⚠️ Нужно стимулировать траты'}`;
                
                await bot.sendMessage(msg.chat.id, economyText, { parse_mode: 'Markdown' });
                break;
                
            default:
                await bot.sendMessage(msg.chat.id, 
                    `🛠 *АДМИН ПАНЕЛЬ*\n\n` +
                    `Доступные команды:\n` +
                    `/admin stats - статистика\n` +
                    `/admin broadcast ТЕКСТ - рассылка\n` +
                    `/admin contest - запустить конкурс\n` +
                    `/admin promo CODE СКИДКА ДАТА - промо\n` +
                    `/admin economy - баланс игры`,
                    { parse_mode: 'Markdown' }
                );
        }
    } catch (error) {
        console.error('Ошибка админ команды:', error);
        await bot.sendMessage(msg.chat.id, '❌ Ошибка выполнения команды');
    }
});

// Автоматические задачи по расписанию
setInterval(async () => {
    try {
        const now = new Date();
        
        // Каждый день в 12:00
        if (now.getHours() === 12 && now.getMinutes() === 0) {
            // Запускаем ежедневный отчет
            const report = await analytics.generateDailyReport();
            console.log('📊 Ежедневный отчет сгенерирован:', report.date);
            
            // Проверяем и награждаем достижения у активных игроков
            const activePlayers = await db.db.all(`
                SELECT DISTINCT telegram_id FROM daily_rewards 
                WHERE DATE(created_at) = DATE('now')
            `);
            
            for (const player of activePlayers) {
                await promotion.checkAndAwardAchievements(player.telegram_id);
            }
        }
        
        // Каждый понедельник в 10:00
        if (now.getDay() === 1 && now.getHours() === 10 && now.getMinutes() === 0) {
            await promotion.runWeeklyContest();
            console.log('🏆 Еженедельный конкурс запущен');
        }
        
        // Каждый 1-й день месяца
        if (now.getDate() === 1 && now.getHours() === 9 && now.getMinutes() === 0) {
            // Рассылка месячного отчета топ реферерам
            const topReferrers = await analytics.getTopReferrers(20);
            
            for (const referrer of topReferrers) {
                if (referrer.successful_referrals > 0) {
                    const bonus = Math.floor(referrer.successful_referrals * 10);
                    
                    await bot.sendMessage(referrer.telegram_id,
                        `🏆 *ВЫ В ТОПЕ РЕФЕРЕРОВ!*\n\n` +
                        `За прошлый месяц вы пригласили ${referrer.successful_referrals} друзей!\n` +
                        `Ваш бонус: ${bonus} 💎\n\n` +
                        `Продолжайте приглашать друзей! 🚀`,
                        { parse_mode: 'Markdown' }
                    );
                    
                    const player = await db.getPlayer(referrer.telegram_id);
                    await db.updatePlayerResources(
                        referrer.telegram_id,
                        player.resources,
                        player.crystals + bonus
                    );
                }
            }
            
            console.log('🎁 Месячные бонусы реферерам выданы');
        }
        
    } catch (error) {
        console.error('Ошибка в scheduled tasks:', error);
    }
}, 60000); // Проверяем каждую минуту

// API для аналитики (только для админа)
app.get('/api/analytics/:type', async (req, res) => {
    const auth = req.headers.authorization;
    const adminId = process.env.TELEGRAM_USER_ID;
    
    if (!auth || auth !== `Bearer ${adminId}`) {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    try {
        switch(req.params.type) {
            case 'growth':
                const growth = await analytics.getPlayerGrowth(30);
                res.json(growth);
                break;
                
            case 'revenue':
                const revenue = await analytics.getRevenueStats(30);
                res.json(revenue);
                break;
                
            case 'retention':
                const retention = await analytics.getPlayerRetention(30);
                res.json(retention);
                break;
                
            case 'referrers':
                const referrers = await analytics.getTopReferrers(50);
                res.json(referrers);
                break;
                
            case 'daily':
                const daily = await analytics.generateDailyReport();
                res.json(daily);
                break;
                
            default:
                res.status(400).json({ error: 'Неверный тип аналитики' });
        }
    } catch (error) {
        console.error('Ошибка аналитики:', error);
        res.status(500).json({ error: 'Внутренняя ошибка' });
    }
});

// Запуск сервера
app.listen(PORT, async () => {
    await db.init();
    console.log(`🚀 Starfall Empire запущен!`);
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🌐 URL: ${WEB_APP_URL}`);
    console.log(`🤖 Бот: @starfallempire_bot`);
    console.log(`💾 База: starfall.db`);
    console.log(`📊 Аналитика: доступна`);
    console.log(`📢 Продвижение: активно`);
    console.log('\n✨ Доступные команды:');
    console.log('   /admin stats - статистика');
    console.log('   /admin broadcast - рассылка');
    console.log('   /admin contest - конкурс');
    console.log('   /admin economy - баланс игры');
    console.log('\n💰 Монетизация:');
    console.log('   • Telegram Stars (реальные платежи)');
    console.log('   • Реферальная система');
    console.log('   • Конкурсы и промоакции');
    console.log('   • Аналитика и оптимизация');
});