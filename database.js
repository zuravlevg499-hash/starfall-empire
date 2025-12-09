const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

class Database {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = await open({
            filename: './starfall.db',
            driver: sqlite3.Database
        });

        await this.createTables();
        console.log('✅ База данных подключена');
        return this.db;
    }

    async createTables() {
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE,
                username TEXT,
                first_name TEXT,
                resources INTEGER DEFAULT 100,
                level INTEGER DEFAULT 1,
                crystals INTEGER DEFAULT 0,
                last_collect INTEGER,
                boost_until INTEGER DEFAULT 0,
                shield_until INTEGER DEFAULT 0,
                daily_streak INTEGER DEFAULT 0,
                last_daily_reward TEXT,
                referrals_count INTEGER DEFAULT 0,
                referred_by INTEGER,
                pvp_wins INTEGER DEFAULT 0,
                pvp_losses INTEGER DEFAULT 0,
                pvp_stolen INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS player_upgrades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER,
                upgrade_type TEXT,
                level INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS player_referrals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_id INTEGER,
                referred_id INTEGER,
                reward_given BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (referrer_id) REFERENCES players(id),
                FOREIGN KEY (referred_id) REFERENCES players(id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER,
                item_type TEXT,
                item_id TEXT,
                amount INTEGER,
                stars_spent INTEGER,
                crystals_received INTEGER,
                status TEXT DEFAULT 'completed',
                telegram_payload TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS pvp_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attacker_id INTEGER,
                defender_id INTEGER,
                attacker_won BOOLEAN,
                resources_stolen INTEGER,
                battle_log TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (attacker_id) REFERENCES players(id),
                FOREIGN KEY (defender_id) REFERENCES players(id)
            )
        `);

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER,
                day_number INTEGER,
                resources_received INTEGER,
                crystals_received INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        `);
    }

    // Игроки
    async getPlayer(telegramId) {
        return await this.db.get(
            'SELECT * FROM players WHERE telegram_id = ?',
            [telegramId]
        );
    }

    async createOrUpdatePlayer(playerData) {
        const existing = await this.getPlayer(playerData.telegram_id);
        
        if (existing) {
            await this.db.run(
                `UPDATE players SET 
                    username = ?, first_name = ?, resources = ?, level = ?, crystals = ?,
                    last_collect = ?, boost_until = ?, shield_until = ?, daily_streak = ?,
                    last_daily_reward = ?, referrals_count = ?, referred_by = ?,
                    pvp_wins = ?, pvp_losses = ?, pvp_stolen = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE telegram_id = ?`,
                [
                    playerData.username,
                    playerData.first_name,
                    playerData.resources || 100,
                    playerData.level || 1,
                    playerData.crystals || 0,
                    playerData.last_collect || Date.now(),
                    playerData.boost_until || 0,
                    playerData.shield_until || 0,
                    playerData.daily_streak || 0,
                    playerData.last_daily_reward || null,
                    playerData.referrals_count || 0,
                    playerData.referred_by || null,
                    playerData.pvp_wins || 0,
                    playerData.pvp_losses || 0,
                    playerData.pvp_stolen || 0,
                    playerData.telegram_id
                ]
            );
            return await this.getPlayer(playerData.telegram_id);
        } else {
            const result = await this.db.run(
                `INSERT INTO players 
                    (telegram_id, username, first_name, resources, level, crystals, 
                     last_collect, boost_until, shield_until, daily_streak, last_daily_reward,
                     referrals_count, referred_by, pvp_wins, pvp_losses, pvp_stolen)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    playerData.telegram_id,
                    playerData.username,
                    playerData.first_name,
                    playerData.resources || 100,
                    playerData.level || 1,
                    playerData.crystals || 0,
                    playerData.last_collect || Date.now(),
                    playerData.boost_until || 0,
                    playerData.shield_until || 0,
                    playerData.daily_streak || 0,
                    playerData.last_daily_reward || null,
                    playerData.referrals_count || 0,
                    playerData.referred_by || null,
                    playerData.pvp_wins || 0,
                    playerData.pvp_losses || 0,
                    playerData.pvp_stolen || 0
                ]
            );
            return await this.getPlayer(playerData.telegram_id);
        }
    }

    async updatePlayerResources(telegramId, resources, crystals = null) {
        const update = crystals !== null 
            ? 'resources = ?, crystals = ?, updated_at = CURRENT_TIMESTAMP'
            : 'resources = ?, updated_at = CURRENT_TIMESTAMP';
        
        const params = crystals !== null 
            ? [resources, crystals, telegramId]
            : [resources, telegramId];
        
        await this.db.run(
            `UPDATE players SET ${update} WHERE telegram_id = ?`,
            params
        );
    }

    // Улучшения
    async getPlayerUpgrades(telegramId) {
        const player = await this.getPlayer(telegramId);
        if (!player) return [];
        
        return await this.db.all(
            'SELECT * FROM player_upgrades WHERE player_id = ?',
            [player.id]
        );
    }

    async addPlayerUpgrade(telegramId, upgradeType) {
        const player = await this.getPlayer(telegramId);
        if (!player) return null;

        const existing = await this.db.get(
            'SELECT * FROM player_upgrades WHERE player_id = ? AND upgrade_type = ?',
            [player.id, upgradeType]
        );

        if (existing) {
            await this.db.run(
                'UPDATE player_upgrades SET level = level + 1 WHERE id = ?',
                [existing.id]
            );
        } else {
            await this.db.run(
                'INSERT INTO player_upgrades (player_id, upgrade_type, level) VALUES (?, ?, 1)',
                [player.id, upgradeType]
            );
        }

        return await this.getPlayerUpgrades(telegramId);
    }

    // Рефералы
    async addReferral(referrerId, referredId) {
        const referrer = await this.getPlayer(referrerId);
        const referred = await this.getPlayer(referredId);
        
        if (!referrer || !referred) return false;

        await this.db.run(
            'INSERT INTO player_referrals (referrer_id, referred_id, reward_given) VALUES (?, ?, 1)',
            [referrer.id, referred.id]
        );

        await this.db.run(
            'UPDATE players SET referrals_count = referrals_count + 1 WHERE id = ?',
            [referrer.id]
        );

        await this.db.run(
            'UPDATE players SET referred_by = ? WHERE id = ?',
            [referrer.id, referred.id]
        );

        return true;
    }

    // Покупки
    async addPurchase(purchaseData) {
        const player = await this.getPlayer(purchaseData.telegram_id);
        if (!player) return null;

        const result = await this.db.run(
            `INSERT INTO purchases 
                (player_id, item_type, item_id, amount, stars_spent, crystals_received, telegram_payload)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                player.id,
                purchaseData.item_type,
                purchaseData.item_id,
                purchaseData.amount,
                purchaseData.stars_spent,
                purchaseData.crystals_received,
                purchaseData.telegram_payload || null
            ]
        );

        return result.lastID;
    }

    // PvP битвы
    async addPvPBattle(battleData) {
        const attacker = await this.getPlayer(battleData.attacker_id);
        const defender = await this.getPlayer(battleData.defender_id);
        
        if (!attacker || !defender) return null;

        const result = await this.db.run(
            `INSERT INTO pvp_battles 
                (attacker_id, defender_id, attacker_won, resources_stolen, battle_log)
             VALUES (?, ?, ?, ?, ?)`,
            [
                attacker.id,
                defender.id,
                battleData.attacker_won ? 1 : 0,
                battleData.resources_stolen,
                JSON.stringify(battleData.battle_log)
            ]
        );

        // Обновляем статистику игроков
        if (battleData.attacker_won) {
            await this.db.run(
                'UPDATE players SET pvp_wins = pvp_wins + 1, pvp_stolen = pvp_stolen + ? WHERE id = ?',
                [battleData.resources_stolen, attacker.id]
            );
            await this.db.run(
                'UPDATE players SET pvp_losses = pvp_losses + 1 WHERE id = ?',
                [defender.id]
            );
        } else {
            await this.db.run(
                'UPDATE players SET pvp_losses = pvp_losses + 1 WHERE id = ?',
                [attacker.id]
            );
        }

        return result.lastID;
    }

    // Ежедневные награды
    async addDailyReward(rewardData) {
        const player = await this.getPlayer(rewardData.telegram_id);
        if (!player) return null;

        const result = await this.db.run(
            `INSERT INTO daily_rewards 
                (player_id, day_number, resources_received, crystals_received)
             VALUES (?, ?, ?, ?)`,
            [
                player.id,
                rewardData.day_number,
                rewardData.resources_received,
                rewardData.crystals_received
            ]
        );

        return result.lastID;
    }

    // Получить топ игроков
    async getTopPlayers(limit = 10) {
        return await this.db.all(`
            SELECT telegram_id, first_name, level, crystals, resources, pvp_wins,
                   (pvp_wins * 100.0 / (pvp_wins + pvp_losses + 1)) as win_rate
            FROM players
            ORDER BY level DESC, crystals DESC
            LIMIT ?
        `, [limit]);
    }

    // Получить статистику
    async getStats() {
        const stats = await this.db.get(`
            SELECT 
                COUNT(*) as total_players,
                SUM(resources) as total_resources,
                SUM(crystals) as total_crystals,
                AVG(level) as avg_level,
                SUM(pvp_wins) as total_pvp_wins,
                SUM(pvp_losses) as total_pvp_losses
            FROM players
        `);

        const today = new Date().toDateString();
        const dailyActive = await this.db.get(`
            SELECT COUNT(DISTINCT player_id) as daily_active
            FROM daily_rewards
            WHERE DATE(created_at) = DATE('now')
        `);

        return {
            ...stats,
            daily_active: dailyActive.daily_active || 0
        };
    }
}

module.exports = new Database();