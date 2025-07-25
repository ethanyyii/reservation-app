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

// 修復：獲取下一場羽球賽日期的邏輯
function getNextGameDate() {
    const now = new Date();
    const today = now.getDay(); // 0=週日, 1=週一, 2=週二, 3=週三, 4=週四, 5=週五, 6=週六
    const currentHour = now.getHours();
    
    // 打球日：週一(1)、週三(3)、週五(5)
    const gameDays = [1, 3, 5];
    
    console.log(`🕐 現在時間：星期${['日','一','二','三','四','五','六'][today]} ${currentHour}點`);
    
    let nextGameDay;
    let daysToAdd = 0;
    let nextDate = new Date(now);
    let isToday = false;
    
    // 🔧 修復邏輯：如果今天是打球日且還沒到9點，可以預約今天
    if (gameDays.includes(today) && currentHour < 9) {
        console.log('✅ 今天是打球日且還沒到9點，可預約今天');
        nextDate = new Date(now);
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
            console.log(`📅 本週還有打球日：星期${['日','一','二','三','四','五','六'][nextGameDay]}`);
        } else {
            // 本週沒有了，找下週的第一個打球日（週一）
            nextGameDay = 1; // 週一
            daysToAdd = 7 - today + 1;
            console.log('📅 本週沒有了，預約下週一');
        }
        
        nextDate.setDate(now.getDate() + daysToAdd);
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
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentHour = now.getHours();
    
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
    res.json({
        success: true,
        message: '智能羽球預約系統正常運行',
        timestamp: new Date().toISOString()
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

// 新增預約
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
        
        const newBooking = {
            id: generateId(),
            name: name.trim(),
            gameDate: nextGame.fullDateString,
            gameDayName: nextGame.dayName,
            gameDateString: nextGame.dateString,
            gameTime: '上午9:00-12:00',
            createdAt: new Date().toISOString()
        };
        
        bookings.push(newBooking);
        await writeBookings(bookings);
        
        console.log(`🏸 新增羽球預約: ${name} - ${nextGame.dayName} ${nextGame.dateString}`);
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
    });
}

startServer();