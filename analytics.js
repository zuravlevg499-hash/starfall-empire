const db = require('./database.js');

class Analytics {
    constructor() {
        this.dailyStats = {};
    }

    async getPlayerGrowth(days = 30) {
        const result = await db.db.all(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as new_players,
                SUM(CASE WHEN referred_by IS NOT NULL THEN 1 ELSE 0 END) as referred
            FROM players
            WHERE created_at >= DATE('now', '-? days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [days]);

        return result;
    }

    async getRevenueStats(days = 30) {
        const result = await db.db.all(`
            SELECT 
                DATE(created_at) as date,
                SUM(stars_spent) as stars_spent,
                SUM(crystals_received) as crystals_given,
                COUNT(*) as purchases_count
            FROM purchases
            WHERE created_at >= DATE('now', '-? days')
                AND status = 'completed'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [days]);

        return result;
    }

    async getPlayerRetention(days = 7) {
        const cohort = await db.db.all(`
            SELECT 
                DATE(created_at) as cohort_date,
                COUNT(DISTINCT p.id) as cohort_size,
                SUM(CASE WHEN dr.created_at >= DATE(p.created_at, '+1 day') THEN 1 ELSE 0 END) as day1,
                SUM(CASE WHEN dr.created_at >= DATE(p.created_at, '+3 day') THEN 1 ELSE 0 END) as day3,
                SUM(CASE WHEN dr.created_at >= DATE(p.created_at, '+7 day') THEN 1 ELSE 0 END) as day7
            FROM players p
            LEFT JOIN daily_rewards dr ON p.id = dr.player_id
            WHERE p.created_at >= DATE('now', '-? days')
            GROUP BY DATE(p.created_at)
            ORDER BY cohort_date DESC
        `, [days * 2]);

        return cohort;
    }

    async getTopReferrers(limit = 10) {
        const result = await db.db.all(`
            SELECT 
                p.telegram_id,
                p.first_name,
                p.referrals_count,
                COUNT(DISTINCT pr.referred_id) as successful_referrals,
                SUM(CASE WHEN pu.status = 'completed' THEN pu.stars_spent ELSE 0 END) as referred_revenue
            FROM players p
            LEFT JOIN player_referrals pr ON p.id = pr.referrer_id
            LEFT JOIN players p2 ON pr.referred_id = p2.id
            LEFT JOIN purchases pu ON p2.id = pu.player_id
            WHERE p.referrals_count > 0
            GROUP BY p.id
            ORDER BY referrals_count DESC, referred_revenue DESC
            LIMIT ?
        `, [limit]);

        return result;
    }

    async getGameBalance() {
        const stats = await db.getStats();
        
        // Рассчитываем экономику игры
        const totalCrystalsInGame = stats.total_crystals;
        const totalPurchasedCrystals = await db.db.get(`
            SELECT SUM(crystals_received) as total FROM purchases WHERE status = 'completed'
        `);

        const crystalsSpent = await db.db.get(`
            SELECT SUM(crystals) as spent FROM (
                SELECT SUM(crystals) as crystals FROM shop_purchases
                UNION ALL
                SELECT SUM(crystals_cost) as crystals FROM upgrade_purchases
            )
        `);

        return {
            total_players: stats.total_players,
            total_crystals_in_game: totalCrystalsInGame,
            total_purchased_crystals: totalPurchasedCrystals?.total || 0,
            total_crystals_spent: crystalsSpent?.spent || 0,
            crystal_velocity: ((crystalsSpent?.spent || 0) / (totalPurchasedCrystals?.total || 1)).toFixed(2)
        };
    }

    async generateDailyReport() {
        const today = new Date().toDateString();
        
        if (this.dailyStats[today]) {
            return this.dailyStats[today];
        }

        const report = {
            date: today,
            players: {
                total: await this.getTotalPlayers(),
                new_today: await this.getNewPlayersToday(),
                active_today: await this.getActivePlayersToday()
            },
            revenue: {
                stars_today: await this.getStarsToday(),
                purchases_today: await this.getPurchasesToday(),
                avg_purchase: await this.getAvgPurchase()
            },
            gameplay: {
                pvp_battles_today: await this.getPvPBattlesToday(),
                daily_rewards_claimed: await this.getDailyRewardsToday(),
                resources_collected: await this.getResourcesCollectedToday()
            },
            retention: {
                day1: await this.getRetentionRate(1),
                day7: await this.getRetentionRate(7),
                day30: await this.getRetentionRate(30)
            }
        };

        this.dailyStats[today] = report;
        return report;
    }

    async getTotalPlayers() {
        const result = await db.db.get('SELECT COUNT(*) as count FROM players');
        return result.count;
    }

    async getNewPlayersToday() {
        const result = await db.db.get(`
            SELECT COUNT(*) as count FROM players 
            WHERE DATE(created_at) = DATE('now')
        `);
        return result.count;
    }

    async getActivePlayersToday() {
        const result = await db.db.get(`
            SELECT COUNT(DISTINCT player_id) as count FROM daily_rewards 
            WHERE DATE(created_at) = DATE('now')
        `);
        return result.count;
    }

    async getStarsToday() {
        const result = await db.db.get(`
            SELECT SUM(stars_spent) as total FROM purchases 
            WHERE DATE(created_at) = DATE('now') AND status = 'completed'
        `);
        return result.total || 0;
    }

    async getPurchasesToday() {
        const result = await db.db.get(`
            SELECT COUNT(*) as count FROM purchases 
            WHERE DATE(created_at) = DATE('now') AND status = 'completed'
        `);
        return result.count;
    }

    async getAvgPurchase() {
        const result = await db.db.get(`
            SELECT AVG(stars_spent) as avg FROM purchases 
            WHERE status = 'completed'
        `);
        return Math.round(result.avg || 0);
    }

    async getPvPBattlesToday() {
        const result = await db.db.get(`
            SELECT COUNT(*) as count FROM pvp_battles 
            WHERE DATE(created_at) = DATE('now')
        `);
        return result.count;
    }

    async getDailyRewardsToday() {
        const result = await db.db.get(`
            SELECT COUNT(*) as count FROM daily_rewards 
            WHERE DATE(created_at) = DATE('now')
        `);
        return result.count;
    }

    async getResourcesCollectedToday() {
        // Оцениваем сбор ресурсов по активности
        const activePlayers = await this.getActivePlayersToday();
        return activePlayers * 100; // Примерная оценка
    }

    async getRetentionRate(days) {
        const result = await db.db.get(`
            SELECT 
                COUNT(DISTINCT p.id) as total,
                COUNT(DISTINCT dr.player_id) as returned
            FROM players p
            LEFT JOIN daily_rewards dr ON p.id = dr.player_id
            WHERE p.created_at <= DATE('now', '-? days')
                AND dr.created_at >= DATE(p.created_at, '+? days')
        `, [days, days]);

        return result.total > 0 ? ((result.returned / result.total) * 100).toFixed(1) + '%' : '0%';
    }
}

module.exports = new Analytics();