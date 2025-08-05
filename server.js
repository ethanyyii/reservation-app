const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bookings.json');

// 中間件設置
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 確保數據文件存在
async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ 數據文件已存在');
    } catch (error) {
        const initialData = { bookings: [] };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ 創建了數據文件');
    }
}

// 讀取預約數據
async function readBookings() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const jsonData = JSON.parse(data);
        return jsonData.bookings || [];
    } catch (error) {
        console.error('讀取數據失敗:', error);
        return [];
    }
}

// 寫入預約數據
async function writeBookings(bookings) {
    try {
        const data = { bookings: bookings, lastUpdated: new Date().toISOString() };
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('寫入數據失敗:', error);
        return false;
    }
}

// 獲取台灣時間
function getTaiwanTime() {
    const now = new Date();
    // 轉換為台灣時間 (UTC+8)
    const taiwanTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return taiwanTime;
}

// 檢查是否為預設會員
function isMember(name) {
    const members = [
        '黃老師', '阿平', '我', '皮', '張清文', '文姿', '智宇', '克拉克',
        'Ben', '雄', '明正', '曜竹', '阿生', '哲維', '查理王', '🦅',
        '怡姍', '控', '彥皓', '海哥', '阿嘉', '許'
    ];
    return members.includes(name.trim());
}

// 檢查臨打報名是否開放
function checkCustomReservationTime(nextGame, currentBookingsCount) {
    const taiwanNow = getTaiwanTime();
    const currentHour = taiwanNow.getHours();
    const currentDay = taiwanNow.getDay(); // 0=週日, 1=週一, ..., 6=週六
    
    // 解析下一場羽球的星期
    const gameDay = getGameDayNumber(nextGame.dayName);
    
    console.log('🕐 檢查臨打報名時間:', {
        currentDay: currentDay,
        currentHour: currentHour,
        gameDay: gameDay,
        isToday: nextGame.isToday,
        bookingCount: currentBookingsCount,
        gameDayName: nextGame.dayName,
        taiwanTime: taiwanNow.toLocaleString('zh-TW')
    });
    
    // 人數檢查：超過17人就不能報名
    if (currentBookingsCount >= 17) {
        return {
            allowed: false,
            reason: '人數已滿 (17人)',
            code: 'FULL_CAPACITY'
        };
    }
    
    // 如果今天就是比賽日
    if (nextGame.isToday) {
        if (currentHour >= 9) {
            return {
                allowed: false,
                reason: '今天比賽已開始，無法報名',
                code: 'GAME_STARTED'
            };
        } else {
            return {
                allowed: true,
                reason: '今天比賽日，早上9點前可報名',
                code: 'GAME_DAY_BEFORE_START'
            };
        }
    }
    
    // 計算前一天是星期幾
    const previousDay = (gameDay === 0 ? 6 : gameDay - 1);
    
    // 如果今天是前一天
    if (currentDay === previousDay) {
        if (currentHour >= 20) {
            return {
                allowed: true,
                reason: '前一天晚上8點後，臨打報名開放',
                code: 'PREVIOUS_DAY_EVENING'
            };
        } else {
            return {
                allowed: false,
                reason: `前一天晚上8點後才開放 (還有 ${20 - currentHour} 小時)`,
                code: 'TOO_EARLY'
            };
        }
    }
    
    // 其他時間都不能臨打報名
    const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return {
        allowed: false,
        reason: `${dayNames[previousDay]}晚上8點後才開放臨打報名`,
        code: 'WRONG_DAY'
    };
}

// 將中文星期轉換為數字
function getGameDayNumber(dayName) {
    const dayMap = {
        '週日': 0, '週一': 1, '週二': 2, '週三': 3, 
        '週四': 4, '週五': 5, '週六': 6
    };
    return dayMap[dayName] || 0;
}

// 使用台灣時間判斷下一場羽球賽
function getNextGameDate() {
    const taiwanNow = getTaiwanTime();
    const today = taiwanNow.getDay(); // 0=週日, 1=週一, 2=週二, 3=週三, 4=週四, 5=週五, 6=週六
    const currentHour = taiwanNow.getHours();
    
    // 打球日：週一(1)、週三(3)、週五(5)
    const gameDays = [1, 3, 5];
    
    console.log(`🕐 台灣現在時間：${taiwanNow.toLocaleString('zh-TW')} (星期${['日','一','二','三','四','五','六'][today]} ${currentHour}點)`);
    
    let nextGameDay;
    let daysToAdd = 0;
    let nextDate = new Date(taiwanNow);
    let isToday = false;
    
    // 如果今天是打球日且還沒到9點，可以預約今天
    if (gameDays.includes(today) && currentHour < 9) {
        console.log('✅ 今天是打球日且還沒到9點，可預約今天');
        nextDate = new Date(taiwanNow);
        nextGameDay = today;
        daysToAdd = 0;
        isToday = true;
    } else {
        console.log('⏭️ 今天不是打球日或已過9點，尋找下一場');
        
        // 找到今天之後的下一個打球日
        const futureGameDays = gameDays.filter(day => day > today);
        
        if (futureGameDays.length > 0) {
            // 本週還有打球日
            nextGameDay = futureGameDays[0];
            daysToAdd = nextGameDay - today;
            console.log(`📅 本週還有打球日：星期${['日','一','二','三','四','五','六'][nextGameDay]} (${daysToAdd}天後)`);
        } else {
            // 本週沒有了，找下週的第一個打球日（週一）
            nextGameDay = 1; // 週一
            daysToAdd = 7 - today + 1;
            console.log(`📅 本週沒有了，預約下週一 (${daysToAdd}天後)`);
        }
        
        nextDate.setDate(taiwanNow.getDate() + daysToAdd);
        isToday = false;
    }
    
    const result = {
        date: nextDate,
        dayName: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][nextGameDay],
        dateString: `${nextDate.getMonth() + 1}/${nextDate.getDate()}`,
        fullDateString: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`,
        isToday: isToday
    };
    
    console.log('🎯 下一場羽球:', result);
    return result;
}

// 清理過期預約
function cleanupExpiredBookings(bookings) {
    const taiwanNow = getTaiwanTime();
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, '0')}-${String(taiwanNow.getDate()).padStart(2, '0')}`;
    const currentHour = taiwanNow.getHours();
    
    return bookings.filter(booking => {
        if (booking.gameDate > today) return true;
        if (booking.gameDate === today && currentHour < 12) return true; // 12點前保留當天預約
        return false;
    });
}

// 生成唯一ID
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// API 路由

// 健康檢查
app.get('/api/health', (req, res) => {
    const taiwanNow = getTaiwanTime();
    res.json({
        success: true,
        message: '智能羽球預約系統正常運行',
        timestamp: new Date().toISOString(),
        taiwanTime: taiwanNow.toLocaleString('zh-TW')
    });
});

// 獲取下一場羽球賽信息
app.get('/api/next-game', (req, res) => {
    try {
        const nextGame = getNextGameDate();
        res.json({
            success: true,
            nextGame: {
                dayName: nextGame.dayName,
                dateString: nextGame.dateString,
                fullDateString: nextGame.fullDateString,
                time: '上午9:00-12:00',
                isToday: nextGame.isToday
            },
            debug: {
                taiwanTime: getTaiwanTime().toLocaleString('zh-TW'),
                serverTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('獲取下一場羽球賽失敗:', error);
        res.status(500).json({ success: false, message: '獲取下一場羽球賽失敗' });
    }
});

// 獲取所有預約
app.get('/api/bookings', async (req, res) => {
    try {
        let bookings = await readBookings();
        bookings = cleanupExpiredBookings(bookings);
        await writeBookings(bookings);
        
        res.json({
            success: true,
            bookings: bookings,
            count: bookings.length
        });
    } catch (error) {
        console.error('獲取預約失敗:', error);
        res.status(500).json({ success: false, message: '獲取預約失敗' });
    }
});

// 新增預約 - 加入時間限制檢查
app.post('/api/bookings', async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: '請填寫球友姓名' });
        }
        
        // 獲取下一場羽球賽信息
        const nextGame = getNextGameDate();
        
        let bookings = await readBookings();
        bookings = cleanupExpiredBookings(bookings);
        
        // 檢查是否已經預約過同一場
        const duplicate = bookings.find(booking => 
            booking.name.toLowerCase() === name.trim().toLowerCase() &&
            booking.gameDate === nextGame.fullDateString
        );
        
        if (duplicate) {
            return res.status(400).json({
                success: false,
                message: `${name} 已經預約過這場羽球了！`
            });
        }
        
        // 檢查是否為會員
        const isUserMember = isMember(name.trim());
        console.log(`👤 用戶身份檢查: ${name} -> ${isUserMember ? '會員' : '臨打'}`);
        
        // 如果不是會員，需要檢查臨打報名時間限制
        if (!isUserMember) {
            const timeCheck = checkCustomReservationTime(nextGame, bookings.length);
            
            if (!timeCheck.allowed) {
                console.log(`❌ 臨打報名被拒絕: ${name} - ${timeCheck.reason}`);
                return res.status(400).json({
                    success: false,
                    message: `臨打報名限制：${timeCheck.reason}`,
                    code: timeCheck.code
                });
            } else {
                console.log(`✅ 臨打報名允許: ${name} - ${timeCheck.reason}`);
            }
        } else {
            console.log(`✅ 會員預約: ${name} - 無時間限制`);
        }
        
        const newBooking = {
            id: generateId(),
            name: name.trim(),
            gameDate: nextGame.fullDateString,
            gameDayName: nextGame.dayName,
            gameDateString: nextGame.dateString,
            gameTime: '上午9:00-12:00',
            isMember: isUserMember,
            createdAt: new Date().toISOString()
        };
        
        bookings.push(newBooking);
        await writeBookings(bookings);
        
        const memberType = isUserMember ? '會員' : '臨打';
        console.log(`🏸 新增羽球預約 (${memberType}): ${name} - ${nextGame.dayName} ${nextGame.dateString}`);
        
        res.json({ 
            success: true, 
            booking: newBooking,
            message: `${name} 成功預約 ${nextGame.dayName} ${nextGame.dateString} 的羽球！`
        });
        
    } catch (error) {
        console.error('新增預約失敗:', error);
        res.status(500).json({ success: false, message: '新增預約失敗' });
    }
});

// 刪除預約
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let bookings = await readBookings();
        
        const originalLength = bookings.length;
        const deletedBooking = bookings.find(booking => booking.id === id);
        bookings = bookings.filter(booking => booking.id !== id);
        
        if (bookings.length === originalLength) {
            return res.status(404).json({ success: false, message: '找不到指定的預約' });
        }
        
        await writeBookings(bookings);
        console.log(`🗑️ 取消羽球預約: ${deletedBooking?.name}`);
        res.json({ success: true, message: '預約已取消' });
        
    } catch (error) {
        console.error('刪除預約失敗:', error);
        res.status(500).json({ success: false, message: '刪除預約失敗' });
    }
});

// 提供前端頁面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 啟動服務器
async function startServer() {
    await ensureDataFile();
    app.listen(PORT, () => {
        console.log(`🏸 智能羽球預約系統已啟動在 port ${PORT}`);
        console.log(`🕐 台灣時間：${getTaiwanTime().toLocaleString('zh-TW')}`);
    });
}

startServer();const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bookings.json');

// 中間件設置
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 確保數據文件存在
async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ 數據文件已存在');
    } catch (error) {
        const initialData = { bookings: [] };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ 創建了數據文件');
    }
}

// 讀取預約數據
async function readBookings() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const jsonData = JSON.parse(data);
        return jsonData.bookings || [];
    } catch (error) {
        console.error('讀取數據失敗:', error);
        return [];
    }
}

// 寫入預約數據
async function writeBookings(bookings) {
    try {
        const data = { bookings: bookings, lastUpdated: new Date().toISOString() };
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('寫入數據失敗:', error);
        return false;
    }
}

// 🔧 修復：獲取台灣時間
function getTaiwanTime() {
    const now = new Date();
    // 轉換為台灣時間 (UTC+8)
    const taiwanTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return taiwanTime;
}

// 🔧 修復：使用台灣時間判斷下一場羽球賽
function getNextGameDate() {
    const taiwanNow = getTaiwanTime();
    const today = taiwanNow.getDay(); // 0=週日, 1=週一, 2=週二, 3=週三, 4=週四, 5=週五, 6=週六
    const currentHour = taiwanNow.getHours();
    
    // 打球日：週一(1)、週三(3)、週五(5)
    const gameDays = [1, 3, 5];
    
    console.log(`🕐 台灣現在時間：${taiwanNow.toLocaleString('zh-TW')} (星期${['日','一','二','三','四','五','六'][today]} ${currentHour}點)`);
    
    let nextGameDay;
    let daysToAdd = 0;
    let nextDate = new Date(taiwanNow);
    let isToday = false;
    
    // 🔧 修復邏輯：如果今天是打球日且還沒到9點，可以預約今天
    if (gameDays.includes(today) && currentHour < 9) {
        console.log('✅ 今天是打球日且還沒到9點，可預約今天');
        nextDate = new Date(taiwanNow);
        nextGameDay = today;
        daysToAdd = 0;
        isToday = true;
    } else {
        console.log('⏭️ 今天不是打球日或已過9點，尋找下一場');
        
        // 找到今天之後的下一個打球日
        const futureGameDays = gameDays.filter(day => day > today);
        
        if (futureGameDays.length > 0) {
            // 本週還有打球日
            nextGameDay = futureGameDays[0];
            daysToAdd = nextGameDay - today;
            console.log(`📅 本週還有打球日：星期${['日','一','二','三','四','五','六'][nextGameDay]} (${daysToAdd}天後)`);
        } else {
            // 本週沒有了，找下週的第一個打球日（週一）
            nextGameDay = 1; // 週一
            daysToAdd = 7 - today + 1;
            console.log(`📅 本週沒有了，預約下週一 (${daysToAdd}天後)`);
        }
        
        nextDate.setDate(taiwanNow.getDate() + daysToAdd);
        isToday = false;
    }
    
    const result = {
        date: nextDate,
        dayName: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][nextGameDay],
        dateString: `${nextDate.getMonth() + 1}/${nextDate.getDate()}`,
        fullDateString: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`,
        isToday: isToday
    };
    
    console.log('🎯 下一場羽球:', result);
    return result;
}

// 🆕 新增：檢查臨打報名是否開放
function checkCustomReservationTime(nextGame, currentBookingsCount, memberNames = []) {
    const taiwanNow = getTaiwanTime();
    const currentHour = taiwanNow.getHours();
    const currentDay = taiwanNow.getDay(); // 0=週日, 1=週一, ..., 6=週六
    
    // 打球日：週一(1)、週三(3)、週五(5)
    const gameDays = [1, 3, 5];
    
    // 解析下一場羽球的星期
    const gameDay = getGameDayNumber(nextGame.dayName);
    
    console.log('🕐 檢查臨打報名時間:', {
        currentDay: currentDay,
        currentHour: currentHour,
        gameDay: gameDay,
        isToday: nextGame.isToday,
        bookingCount: currentBookingsCount,
        gameDayName: nextGame.dayName
    });
    
    // 人數檢查：超過17人就不能報名
    if (currentBookingsCount >= 17) {
        return {
            allowed: false,
            reason: '人數已滿 (17人)',
            code: 'FULL_CAPACITY'
        };
    }
    
    // 如果今天就是比賽日
    if (nextGame.isToday) {
        if (currentHour >= 9) {
            return {
                allowed: false,
                reason: '今天比賽已開始，無法報名',
                code: 'GAME_STARTED'
            };
        } else {
            // 今天比賽日且還沒9點，允許會員報名，臨打需檢查是否從昨晚8點開始
            const yesterday = currentDay === 0 ? 6 : currentDay - 1;
            return {
                allowed: true,
                reason: '今天比賽日，早上9點前可報名',
                code: 'GAME_DAY_BEFORE_START'
            };
        }
    }
    
    // 計算前一天是星期幾
    const previousDay = (gameDay === 0 ? 6 : gameDay - 1);
    
    // 如果今天是前一天
    if (currentDay === previousDay) {
        if (currentHour >= 20) {
            return {
                allowed: true,
                reason: '前一天晚上8點後，臨打報名開放',
                code: 'PREVIOUS_DAY_EVENING'
            };
        } else {
            return {
                allowed: false,
                reason: `前一天晚上8點後才開放 (還有 ${20 - currentHour} 小時)`,
                code: 'TOO_EARLY'
            };
        }
    }
    
    // 其他時間都不能臨打報名
    const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return {
        allowed: false,
        reason: `${dayNames[previousDay]}晚上8點後才開放臨打報名`,
        code: 'WRONG_DAY'
    };
}

// 輔助函數：將中文星期轉換為數字
function getGameDayNumber(dayName) {
    const dayMap = {
        '週日': 0, '週一': 1, '週二': 2, '週三': 3, 
        '週四': 4, '週五': 5, '週六': 6
    };
    return dayMap[dayName] || 0;
}

// 檢查是否為預設會員
function isMember(name) {
    const members = [
        '黃老師', '阿平', '我', '皮', '張清文', '文姿', '智宇', '克拉克',
        'Ben', '雄', '明正', '曜竹', '阿生', '哲維', '查理王', '🦅',
        '怡姍', '控', '彥皓', '海哥', '阿嘉', '許'
    ];
    return members.includes(name.trim());
}

// 清理過期預約
function cleanupExpiredBookings(bookings) {
    const taiwanNow = getTaiwanTime();
    const today = `${taiwanNow.getFullYear()}-${String(taiwanNow.getMonth() + 1).padStart(2, '0')}-${String(taiwanNow.getDate()).padStart(2, '0')}`;
    const currentHour = taiwanNow.getHours();
    
    return bookings.filter(booking => {
        if (booking.gameDate > today) return true;
        if (booking.gameDate === today && currentHour < 12) return true; // 12點前保留當天預約
        return false;
    });
}

// 生成唯一ID
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// API 路由

// 健康檢查
app.get('/api/health', (req, res) => {
    const taiwanNow = getTaiwanTime();
    res.json({
        success: true,
        message: '智能羽球預約系統正常運行',
        timestamp: new Date().toISOString(),
        taiwanTime: taiwanNow.toLocaleString('zh-TW')
    });
});

// 獲取下一場羽球賽信息
app.get('/api/next-game', (req, res) => {
    try {
        const nextGame = getNextGameDate();
        res.json({
            success: true,
            nextGame: {
                dayName: nextGame.dayName,
                dateString: nextGame.dateString,
                fullDateString: nextGame.fullDateString,
                time: '上午9:00-12:00',
                isToday: nextGame.isToday
            },
            debug: {
                taiwanTime: getTaiwanTime().toLocaleString('zh-TW'),
                serverTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('獲取下一場羽球賽失敗:', error);
        res.status(500).json({ success: false, message: '獲取下一場羽球賽失敗' });
    }
});

// 獲取所有預約
app.get('/api/bookings', async (req, res) => {
    try {
        let bookings = await readBookings();
        bookings = cleanupExpiredBookings(bookings);
        await writeBookings(bookings);
        
        res.json({
            success: true,
            bookings: bookings,
            count: bookings.length
        });
    } catch (error) {
        console.error('獲取預約失敗:', error);
        res.status(500).json({ success: false, message: '獲取預約失敗' });
    }
});

// 🆕 修改：新增預約 - 加入時間限制檢查
app.post('/api/bookings', async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: '請填寫球友姓名' });
        }
        
        // 獲取下一場羽球賽信息
        const nextGame = getNextGameDate();
        
        let bookings = await readBookings();
        bookings = cleanupExpiredBookings(bookings);
        
        // 檢查是否已經預約過同一場
        const duplicate = bookings.find(booking => 
            booking.name.toLowerCase() === name.trim().toLowerCase() &&
            booking.gameDate === nextGame.fullDateString
        );
        
        if (duplicate) {
            return res.status(400).json({
                success: false,
                message: `${name} 已經預約過這場羽球了！`
            });
        }
        
        // 🆕 檢查是否為會員
        const isUserMember = isMember(name.trim());
        
        // 🆕 如果不是會員，需要檢查臨打報名時間限制
        if (!isUserMember) {
            const timeCheck = checkCustomReservationTime(nextGame, bookings.length);
            
            if (!timeCheck.allowed) {
                console.log(`❌ 臨打報名被拒絕: ${name} - ${timeCheck.reason}`);
                return res.status(400).json({
                    success: false,
                    message: `臨打報名限制：${timeCheck.reason}`,
                    code: timeCheck.code
                });
            }
        }
        
        const newBooking = {
            id: generateId(),
            name: name.trim(),
            gameDate: nextGame.fullDateString,
            gameDayName: nextGame.dayName,
            gameDateString: nextGame.dateString,
            gameTime: '上午9:00-12:00',
            isMember: isUserMember,
            createdAt: new Date().toISOString()
        };
        
        bookings.push(newBooking);
        await writeBookings(bookings);
        
        const memberType = isUserMember ? '會員' : '臨打';
        console.log(`🏸 新增羽球預約 (${memberType}): ${name} - ${nextGame.dayName} ${nextGame.dateString}`);
        
        res.json({ 
            success: true, 
            booking: newBooking,
            message: `${name} 成功預約 ${nextGame.dayName} ${nextGame.dateString} 的羽球！`
        });
        
    } catch (error) {
        console.error('新增預約失敗:', error);
        res.status(500).json({ success: false, message: '新增預約失敗' });
    }
});

// 刪除預約
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let bookings = await readBookings();
        
        const originalLength = bookings.length;
        const deletedBooking = bookings.find(booking => booking.id === id);
        bookings = bookings.filter(booking => booking.id !== id);
        
        if (bookings.length === originalLength) {
            return res.status(404).json({ success: false, message: '找不到指定的預約' });
        }
        
        await writeBookings(bookings);
        console.log(`🗑️ 取消羽球預約: ${deletedBooking?.name}`);
        res.json({ success: true, message: '預約已取消' });
        
    } catch (error) {
        console.error('刪除預約失敗:', error);
        res.status(500).json({ success: false, message: '刪除預約失敗' });
    }
});

// 提供前端頁面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 啟動服務器
async function startServer() {
    await ensureDataFile();
    app.listen(PORT, () => {
        console.log(`🏸 智能羽球預約系統已啟動在 port ${PORT}`);
        console.log(`🕐 台灣時間：${getTaiwanTime().toLocaleString('zh-TW')}`);
    });
}

startServer();