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
app.use(express.static('public')); // 提供靜態文件服務

// 確保數據文件存在
async function ensureDataFile() {
    try {
        await fs.access(DATA_FILE);
        console.log('✅ 數據文件已存在');
    } catch (error) {
        const initialData = { bookings: [], lastUpdated: new Date().toISOString() };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ 創建了新的數據文件');
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
        const data = { 
            bookings: bookings, 
            lastUpdated: new Date().toISOString(),
            count: bookings.length
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('寫入數據失敗:', error);
        return false;
    }
}

// 清理過期預約
function cleanupExpiredBookings(bookings) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return bookings.filter(booking => {
        // 保留未來的預約
        if (booking.month > currentMonth) return true;
        if (booking.month === currentMonth && booking.day > currentDay) return true;
        if (booking.month === currentMonth && booking.day === currentDay && booking.time > currentTime) return true;
        
        // 移除過期的預約
        return false;
    });
}

// 生成唯一ID
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// 驗證預約數據
function validateBookingData(data) {
    const { name, month, day, time } = data;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return { valid: false, message: '姓名不能為空' };
    }
    
    if (!month || !day || !time) {
        return { valid: false, message: '所有欄位都是必填的' };
    }
    
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return { valid: false, message: '月份必須在1-12之間' };
    }
    
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        return { valid: false, message: '日期必須在1-31之間' };
    }
    
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
        return { valid: false, message: '時間格式不正確' };
    }
    
    // 檢查是否為過去時間
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    let isPastTime = false;
    if (monthNum < currentMonth) {
        isPastTime = true;
    } else if (monthNum === currentMonth && dayNum < currentDay) {
        isPastTime = true;
    } else if (monthNum === currentMonth && dayNum === currentDay && time < currentTime) {
        isPastTime = true;
    }
    
    if (isPastTime) {
        return { valid: false, message: '無法預約過去的時間' };
    }
    
    return { valid: true };
}

// API 路由

// 健康檢查端點
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: '球友預約系統後端服務正常運行',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 獲取所有預約
app.get('/api/bookings', async (req, res) => {
    try {
        let bookings = await readBookings();
        
        // 清理過期預約
        const originalLength = bookings.length;
        bookings = cleanupExpiredBookings(bookings);
        
        // 如果有預約被清理，更新文件
        if (bookings.length !== originalLength) {
            await writeBookings(bookings);
            console.log(`🧹 清理了 ${originalLength - bookings.length} 個過期預約`);
        }
        
        res.json({
            success: true,
            bookings: bookings,
            count: bookings.length,
            serverTime: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ 獲取預約失敗:', error);
        res.status(500).json({
            success: false,
            message: '獲取預約失敗',
            error: error.message
        });
    }
});

// 新增預約
app.post('/api/bookings', async (req, res) => {
    try {
        const bookingData = req.body;
        
        // 驗證輸入
        const validation = validateBookingData(bookingData);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }
        
        const { name, month, day, time } = bookingData;
        
        // 讀取現有預約
        let bookings = await readBookings();
        
        // 清理過期預約
        bookings = cleanupExpiredBookings(bookings);
        
        // 檢查是否有重複預約
        const duplicate = bookings.find(booking => 
            booking.name.toLowerCase() === name.trim().toLowerCase() &&
            booking.month === parseInt(month) &&
            booking.day === parseInt(day) &&
            booking.time === time
        );
        
        if (duplicate) {
            return res.status(400).json({
                success: false,
                message: '已存在相同的預約記錄'
            });
        }
        
        // 創建新預約
        const newBooking = {
            id: generateId(),
            name: name.trim(),
            month: parseInt(month),
            day: parseInt(day),
            time: time,
            createdAt: new Date().toISOString(),
            ip: req.ip || 'unknown'
        };
        
        // 添加到列表
        bookings.push(newBooking);
        
        // 保存到文件
        const success = await writeBookings(bookings);
        
        if (success) {
            console.log(`🏀 新增預約: ${name} - ${month}/${day} ${time}`);
            res.json({
                success: true,
                message: '預約成功',
                booking: {
                    id: newBooking.id,
                    name: newBooking.name,
                    month: newBooking.month,
                    day: newBooking.day,
                    time: newBooking.time,
                    createdAt: newBooking.createdAt
                },
                totalCount: bookings.length
            });
        } else {
            res.status(500).json({
                success: false,
                message: '保存預約失敗'
            });
        }
        
    } catch (error) {
        console.error('❌ 新增預約失敗:', error);
        res.status(500).json({
            success: false,
            message: '新增預約時發生錯誤',
            error: error.message
        });
    }
});

// 刪除預約
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({
                success: false,
                message: '預約ID是必需的'
            });
        }
        
        // 讀取現有預約
        let bookings = await readBookings();
        
        // 找到要刪除的預約
        const bookingIndex = bookings.findIndex(booking => booking.id === id);
        
        if (bookingIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '找不到指定的預約'
            });
        }
        
        // 移除預約
        const deletedBooking = bookings.splice(bookingIndex, 1)[0];
        
        // 保存更新後的列表
        const success = await writeBookings(bookings);
        
        if (success) {
            console.log(`🗑️ 刪除預約: ${deletedBooking.name} - ${deletedBooking.month}/${deletedBooking.day} ${deletedBooking.time}`);
            res.json({
                success: true,
                message: '預約已取消',
                deletedBooking: {
                    id: deletedBooking.id,
                    name: deletedBooking.name,
                    month: deletedBooking.month,
                    day: deletedBooking.day,
                    time: deletedBooking.time
                },
                totalCount: bookings.length
            });
        } else {
            res.status(500).json({
                success: false,
                message: '刪除預約失敗'
            });
        }
        
    } catch (error) {
        console.error('❌ 刪除預約失敗:', error);
        res.status(500).json({
            success: false,
            message: '刪除預約時發生錯誤',
            error: error.message
        });
    }
});

// 獲取統計信息
app.get('/api/stats', async (req, res) => {
    try {
        const bookings = await readBookings();
        const cleanedBookings = cleanupExpiredBookings(bookings);
        
        const stats = {
            totalBookings: cleanedBookings.length,
            todayBookings: cleanedBookings.filter(booking => {
                const now = new Date();
                return booking.month === now.getMonth() + 1 && booking.day === now.getDate();
            }).length,
            uniquePlayers: [...new Set(cleanedBookings.map(b => b.name))].length,
            serverTime: new Date().toISOString()
        };
        
        res.json({
            success: true,
            stats: stats
        });
        
    } catch (error) {
        console.error('❌ 獲取統計信息失敗:', error);
        res.status(500).json({
            success: false,
            message: '獲取統計信息失敗'
        });
    }
});

// 提供前端頁面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 錯誤處理中間件
app.use((error, req, res, next) => {
    console.error('🚨 服務器錯誤:', error);
    res.status(500).json({
        success: false,
        message: '服務器內部錯誤'
    });
});

// 處理未找到的路由
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '找不到請求的資源',
        path: req.path
    });
});

// 定期清理過期預約 (每30分鐘執行一次)
setInterval(async () => {
    try {
        let bookings = await readBookings();
        const originalLength = bookings.length;
        bookings = cleanupExpiredBookings(bookings);
        
        if (bookings.length !== originalLength) {
            await writeBookings(bookings);
            console.log(`🧹 定期清理: 移除了 ${originalLength - bookings.length} 個過期預約`);
        }
    } catch (error) {
        console.error('❌ 定期清理失敗:', error);
    }
}, 30 * 60 * 1000); // 30分鐘

// 啟動服務器
async function startServer() {
    try {
        // 確保數據文件存在
        await ensureDataFile();
        
        app.listen(PORT, () => {
            console.log('\n🏀 球友預約系統後端服務已啟動！');
            console.log(`📍 本地訪問: http://localhost:${PORT}`);
            console.log(`🌐 API 端點: http://localhost:${PORT}/api`);
            console.log(`📁 數據文件: ${DATA_FILE}`);
            console.log(`⏰ 啟動時間: ${new Date().toLocaleString('zh-TW')}`);
            console.log('✨ 支援即時同步，讓所有球友都能看到最新預約！\n');
        });
    } catch (error) {
        console.error('❌ 啟動服務器失敗:', error);
        process.exit(1);
    }
}

// 優雅關閉
process.on('SIGINT', async () => {
    console.log('\n🛑 正在關閉服務器...');
    console.log('👋 球友預約系統已安全關閉');
    process.exit(0);
});

// 啟動應用
startServer();