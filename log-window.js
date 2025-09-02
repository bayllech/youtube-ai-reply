// YouTube Reply Log Window
// Creates a floating log window for debugging

class FloatingLogWindow {
    constructor() {
        this.window = null;
        this.logs = [];
        this.isVisible = false;
        this.init();
    }

    init() {
        this.createWindow();
        this.setupEventListeners();
        this.addLog('info', '日志窗口已初始化');
    }

    createWindow() {
        // Remove existing window
        const existing = document.getElementById('youtube-reply-log-window');
        if (existing) {
            existing.remove();
        }

        this.window = document.createElement('div');
        this.window.id = 'youtube-reply-log-window';
        this.window.innerHTML = `
            <div id="youtube-reply-log-header">
                <span>YouTube AI Reply 日志</span>
                <button id="youtube-reply-log-clear">清空</button>
                <button id="youtube-reply-log-close">×</button>
            </div>
            <div id="youtube-reply-log-content"></div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #youtube-reply-log-window {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 400px;
                height: 300px;
                background: white;
                border: 2px solid #4285f4;
                border-radius: 8px;
                z-index: 999999;
                display: none;
                flex-direction: column;
                font-family: monospace;
                font-size: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            #youtube-reply-log-header {
                background: #4285f4;
                color: white;
                padding: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                user-select: none;
            }
            #youtube-reply-log-content {
                flex: 1;
                overflow-y: auto;
                padding: 8px;
                background: #f8f9fa;
            }
            .log-entry {
                margin: 4px 0;
                padding: 4px;
                border-radius: 4px;
            }
            .log-info { background: #e3f2fd; color: #1976d2; }
            .log-success { background: #e8f5e9; color: #388e3c; }
            .log-warning { background: #fff3e0; color: #f57c00; }
            .log-error { background: #ffebee; color: #d32f2f; }
            .log-debug { background: #f3e5f5; color: #7b1fa2; }
            .log-processing { background: #e0f2f1; color: #00796b; }
        `;

        document.head.appendChild(style);
        document.body.appendChild(this.window);

        // Make draggable
        this.makeDraggable();

        // Setup buttons
        document.getElementById('youtube-reply-log-clear').addEventListener('click', () => {
            this.clearLogs();
        });

        document.getElementById('youtube-reply-log-close').addEventListener('click', () => {
            this.hide();
        });
    }

    makeDraggable() {
        const header = document.getElementById('youtube-reply-log-header');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialX = e.clientX - this.window.offsetLeft;
            initialY = e.clientY - this.window.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                this.window.style.left = currentX + 'px';
                this.window.style.top = currentY + 'px';
                this.window.style.right = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    setupEventListeners() {
        // Listen for toggle messages
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.action === 'toggleLog') {
                    this.toggle();
                    sendResponse({ success: true });
                }
            });
        }

        // Keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    addLog(type, message, data = null) {
        const log = {
            type,
            message,
            data,
            timestamp: new Date()
        };
        
        this.logs.push(log);
        this.renderLog(log);
        
        // Also log to console
        console.log(`[YouTube AI Reply ${type.toUpperCase()}]`, message, data || '');
    }

    renderLog(log) {
        if (!this.window) return;
        
        const content = this.window.querySelector('#youtube-reply-log-content');
        const entry = document.createElement('div');
        entry.className = `log-entry log-${log.type}`;
        
        const timestamp = log.timestamp.toLocaleTimeString();
        let text = `[${timestamp}] ${log.message}`;
        
        if (log.data) {
            if (typeof log.data === 'object') {
                text += ' ' + JSON.stringify(log.data);
            } else {
                text += ' ' + log.data;
            }
        }
        
        entry.textContent = text;
        content.appendChild(entry);
        content.scrollTop = content.scrollHeight;
    }

    show() {
        if (this.window) {
            // 确保窗口在body的最后（最上层）
            document.body.appendChild(this.window);
            
            // 重置样式
            this.window.style.cssText = `
                position: fixed !important;
                top: 20px !important;
                right: 20px !important;
                width: 400px !important;
                height: 300px !important;
                background: white !important;
                border: 2px solid #4285f4 !important;
                border-radius: 8px !important;
                z-index: 2147483647 !important;
                display: flex !important;
                flex-direction: column !important;
                font-family: monospace !important;
                font-size: 12px !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
                opacity: 1 !important;
                visibility: visible !important;
                transform: none !important;
            `;
            
            this.isVisible = true;
        } else {
            console.error('[YouTube AI Reply] 无法显示日志窗口：window元素不存在');
        }
    }

    hide() {
        if (this.window) {
            this.window.style.display = 'none';
            this.isVisible = false;
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    clearLogs() {
        this.logs = [];
        const content = this.window.querySelector('#youtube-reply-log-content');
        if (content) {
            content.innerHTML = '';
        }
    }

    info(message, data) { this.addLog('info', message, data); }
    success(message, data) { this.addLog('success', message, data); }
    warning(message, data) { this.addLog('warning', message, data); }
    error(message, data) { this.addLog('error', message, data); }
    debug(message, data) { this.addLog('debug', message, data); }
    processing(message, data) { this.addLog('processing', message, data); }
}

// Create global log instance
window.youtubeReplyLog = new FloatingLogWindow();

// 添加独立的日志窗口按钮
function addIndependentLogButton() {
    // 检查是否已存在
    if (document.getElementById('youtube-reply-log-indicator')) {
        return;
    }
    
    const logBtn = document.createElement('div');
    logBtn.id = 'youtube-reply-log-indicator';
    logBtn.innerHTML = '📋 LOG';
    logBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4285f4;
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        z-index: 2147483646;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(66, 133, 244, 0.4);
        transition: all 0.3s ease;
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    `;
    
    logBtn.addEventListener('click', () => {
        window.youtubeReplyLog.toggle();
        // 改变按钮颜色作为反馈
        logBtn.style.background = logBtn.style.background === 'rgb(255, 68, 68)' ? '#4285f4' : '#ff4444';
    });
    
    logBtn.addEventListener('mouseenter', () => {
        logBtn.style.transform = 'scale(1.05)';
        logBtn.style.boxShadow = '0 6px 16px rgba(66, 133, 244, 0.6)';
    });
    
    logBtn.addEventListener('mouseleave', () => {
        logBtn.style.transform = 'scale(1)';
        logBtn.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.4)';
    });
    
    document.body.appendChild(logBtn);
}

// 延迟添加按钮，确保页面加载完成
setTimeout(addIndependentLogButton, 1000);

// Export for use in other scripts
window.youtubeReplyLog.version = '1.0.0';