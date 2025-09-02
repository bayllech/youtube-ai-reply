// YouTube Reply Log Window
// Creates a floating log window for debugging

class FloatingLogWindow {
    constructor() {
        this.window = null;
        this.logs = [];
        this.isVisible = false;
        this.isExpanded = false;
        this.replyCount = 0;
        this.maxReplies = 10;
        this.currentReplyNumber = 0;
        this.lastAutoReplyStatus = null;
        this.isDragging = false;
        this.isIndicatorDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isPositioned = false;
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
        // 创建贴边按钮
        this.indicator = document.createElement('div');
        this.indicator.id = 'youtube-reply-log-indicator';
        this.indicator.innerHTML = `
            <div class="log-icon">📋</div>
            <div class="log-stats">
                <span class="reply-count">0/10</span>
            </div>
            <div class="drag-handle">⋮⋮</div>
        `;
        
        // 创建日志面板
        this.panel = document.createElement('div');
        this.panel.id = 'youtube-reply-log-panel';
        this.panel.innerHTML = `
            <div id="youtube-reply-log-header">
                <span>YouTube AI Reply 日志</span>
                <div class="header-controls">
                    <button id="youtube-reply-log-reset">重置设置</button>
                    <button id="youtube-reply-log-clear">清空</button>
                    <button id="youtube-reply-log-close">×</button>
                </div>
            </div>
            <div id="youtube-reply-log-content"></div>
        `;
        
        this.window.appendChild(this.indicator);
        this.window.appendChild(this.panel);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #youtube-reply-log-window {
                position: fixed;
                top: 120px;
                right: 0;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            }
            
            #youtube-reply-log-indicator {
                width: 60px;
                height: 65px;
                background: #4285f4;
                border-radius: 30px 0 0 30px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: -2px 2px 8px rgba(0,0,0,0.2);
                position: relative;
                overflow: visible;
            }
            
            #youtube-reply-log-indicator:hover {
                width: 70px;
                box-shadow: -4px 4px 12px rgba(0,0,0,0.3);
            }
            
            .log-icon {
                font-size: 20px;
                margin-bottom: 2px;
            }
            
            .log-stats {
                color: white;
                font-size: 11px;
                font-weight: bold;
            }
            
            .reply-count {
                background: rgba(255,255,255,0.2);
                padding: 2px 6px;
                border-radius: 10px;
            }
            
            .drag-handle {
                position: absolute;
                bottom: -3px;
                left: 50%;
                transform: translateX(-50%);
                color: rgba(255,255,255,0.7);
                font-size: 10px;
                cursor: ns-resize;
                padding: 3px 6px;
                border-radius: 8px;
                transition: all 0.2s ease;
                background: rgba(0,0,0,0.3);
                line-height: 0.8;
                letter-spacing: 1px;
                opacity: 0.6;
            }
            
            .drag-handle:hover {
                color: rgba(255,255,255,1);
                background: rgba(0,0,0,0.5);
                opacity: 1;
                transform: translateX(-50%) scale(1.1);
            }
            
            #youtube-reply-log-panel {
                position: absolute;
                top: 0;
                right: 60px;
                width: 400px;
                height: 400px;
                background: white;
                border: 2px solid #4285f4;
                border-radius: 8px 0 0 8px;
                display: none;
                flex-direction: column;
                box-shadow: -4px 4px 16px rgba(0,0,0,0.2);
                opacity: 0;
                transform: translateX(20px);
                transition: all 0.3s ease;
            }
            
            #youtube-reply-log-panel.dragging {
                display: flex !important;
                opacity: 1 !important;
                transform: none !important;
                position: fixed !important;
                border-radius: 8px !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
            }
            
            #youtube-reply-log-panel[style*="left"][style*="top"] {
                display: flex !important;
                opacity: 1 !important;
                transform: none !important;
                position: fixed !important;
                border-radius: 8px !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
            }
            
            #youtube-reply-log-window:hover #youtube-reply-log-panel:not(.dragging):not([style*="left"]) {
                display: flex;
                opacity: 1;
                transform: translateX(0);
            }
            
            #youtube-reply-log-header {
                background: #4285f4;
                color: white;
                padding: 10px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                user-select: none;
                border-radius: 6px 0 0 0;
                cursor: move;
            }
            
            #youtube-reply-log-panel.dragging #youtube-reply-log-header {
                border-radius: 6px 6px 0 0;
            }
            
            .header-controls {
                display: flex;
                gap: 5px;
            }
            
            #youtube-reply-log-content {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                background: #f8f9fa;
                font-size: 12px;
            }
            
            .log-entry {
                margin: 6px 0;
                padding: 6px 8px;
                border-radius: 4px;
                line-height: 1.4;
                border-left: 3px solid transparent;
            }
            
            .log-info { 
                background: #e3f2fd; 
                color: #1976d2; 
                border-left-color: #1976d2;
            }
            
            .log-success { 
                background: #e8f5e9; 
                color: #388e3c; 
                border-left-color: #388e3c;
            }
            
            .log-warning { 
                background: #fff3e0; 
                color: #f57c00; 
                border-left-color: #f57c00;
            }
            
            .log-error { 
                background: #ffebee; 
                color: #d32f2f; 
                border-left-color: #d32f2f;
            }
            
            .log-debug { 
                background: #f3e5f5; 
                color: #7b1fa2; 
                border-left-color: #7b1fa2;
            }
            
            .log-processing { 
                background: #e0f2f1; 
                color: #00796b; 
                border-left-color: #00796b;
            }
            
            .log-step {
                background: #fff8e1;
                color: #ff8f00;
                border-left-color: #ff8f00;
                font-weight: 500;
            }
            
            .log-status {
                background: #e8eaf6;
                color: #3f51b5;
                border-left-color: #3f51b5;
                font-weight: 500;
            }
            
            #youtube-reply-log-header button {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            }
            
            #youtube-reply-log-header button:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.1);
            }
            
            #youtube-reply-log-header button:active {
                transform: scale(0.95);
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(this.window);

        // Setup buttons
        document.getElementById('youtube-reply-log-reset').addEventListener('click', () => {
            this.resetSettings();
        });

        document.getElementById('youtube-reply-log-clear').addEventListener('click', () => {
            this.clearLogs();
        });

        document.getElementById('youtube-reply-log-close').addEventListener('click', () => {
            this.resetPosition();
            this.hidePanel();
        });
        
        // Setup click event for indicator
        this.indicator.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isPositioned) {
                // 如果面板已被拖动过，重置位置
                this.resetPosition();
            } else {
                // 切换面板显示
                if (this.panel.style.display === 'none' || this.panel.style.display === '') {
                    this.showPanel();
                } else {
                    this.hidePanel();
                }
            }
        });
        
        // Setup drag handle for indicator
        const dragHandle = this.indicator.querySelector('.drag-handle');
        dragHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isIndicatorDragging = true;
            this.dragOffset.y = e.clientY - this.window.offsetTop;
            this.window.style.cursor = 'ns-resize';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (this.isIndicatorDragging) {
                const y = e.clientY - this.dragOffset.y;
                const maxY = window.innerHeight - this.window.offsetHeight;
                this.window.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isIndicatorDragging) {
                this.isIndicatorDragging = false;
                this.window.style.cursor = '';
            }
        });
        
        // Setup hover events
        this.indicator.addEventListener('mouseenter', () => {
            if (!this.isDragging && !this.isPositioned) {
                this.isExpanded = true;
            }
        });
        
        this.indicator.addEventListener('mouseleave', () => {
            if (!this.isDragging && !this.isPositioned) {
                // 延迟收起，避免鼠标意外移出
                setTimeout(() => {
                    if (!this.panel.matches(':hover') && !this.indicator.matches(':hover')) {
                        this.isExpanded = false;
                        this.hidePanel();
                    }
                }, 500);
            }
        });
        
        // 面板本身的鼠标事件
        this.panel.addEventListener('mouseenter', () => {
            if (!this.isDragging && !this.isPositioned) {
                this.isExpanded = true;
            }
        });
        
        this.panel.addEventListener('mouseleave', () => {
            if (!this.isDragging && !this.isPositioned) {
                // 延迟收起，避免鼠标意外移出
                setTimeout(() => {
                    if (!this.panel.matches(':hover') && !this.indicator.matches(':hover')) {
                        this.isExpanded = false;
                        this.hidePanel();
                    }
                }, 500);
            }
        });
        
        // Setup drag functionality
        this.setupDrag();
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
        // 过滤掉重复的自动回复状态日志
        if (type === 'debug' && message.includes('自动回复状态:')) {
            const currentStatus = JSON.stringify(data);
            if (this.lastAutoReplyStatus === currentStatus) {
                return; // 跳过重复的状态日志
            }
            this.lastAutoReplyStatus = currentStatus;
        }
        
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
        if (!this.panel) return;
        
        const content = this.panel.querySelector('#youtube-reply-log-content');
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
            this.window.style.display = 'block';
            this.isVisible = true;
        }
    }

    hide() {
        if (this.window) {
            this.window.style.display = 'none';
            this.isVisible = false;
        }
    }
    
    hidePanel() {
        if (this.panel && !this.isPositioned) {
            this.panel.style.display = 'none';
            this.panel.style.opacity = '0';
        }
    }
    
    showPanel() {
        if (this.panel) {
            this.panel.style.display = 'flex';
            this.panel.style.opacity = '1';
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
        const content = this.panel.querySelector('#youtube-reply-log-content');
        if (content) {
            content.innerHTML = '';
        }
    }
    
    async resetSettings() {
        try {
            const defaultSettings = {
                enabled: false,
                apiKey: '',
                replyDelay: 3000,
                replyStyle: 'friendly',
                maxRepliesPerSession: 10,
                autoReplyEnabled: false,
                aiRole: `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`,
                presetReplies: [
                    '感谢你的评论！💖',
                    '谢谢你的支持！🎵',
                    '很高兴你喜欢我的音乐！🎶',
                    '你的评论让我很开心！😊'
                ],
                localReplyRules: [
                    '纯表情符号',
                    '单个字或标点',
                    '无意义的字符'
                ]
            };
            
            // 保存默认设置
            const response = await chrome.runtime.sendMessage({ 
                action: 'saveSettings', 
                settings: defaultSettings 
            });
            
            if (response && response.success) {
                this.addLog('success', '设置已重置为默认值');
                
                // 通知页面重新加载设置
                if (window.commentMonitor) {
                    window.commentMonitor.loadSettings();
                }
            } else {
                throw new Error('保存失败');
            }
            
        } catch (error) {
            this.addLog('error', '重置设置失败: ' + error.message);
        }
    }
    
    // 重置面板位置
    resetPosition() {
        this.isPositioned = false;
        this.panel.style.left = '';
        this.panel.style.top = '';
        this.panel.style.transform = '';
        this.panel.classList.remove('dragging');
        // 重置到默认的显示状态
        this.panel.style.display = '';
        this.panel.style.opacity = '';
        this.addLog('info', '📌 日志面板已重置到初始位置');
    }
    
    // 更新回复计数显示
    updateReplyCount(count, max) {
        this.replyCount = count;
        this.maxReplies = max;
        const countElement = this.indicator.querySelector('.reply-count');
        if (countElement) {
            // 如果max为null，使用默认值10
            const displayMax = max || 10;
            countElement.textContent = `${count}/${displayMax}`;
            
            // 根据进度改变颜色
            const ratio = count / displayMax;
            if (ratio >= 1) {
                countElement.style.background = 'rgba(244, 67, 54, 0.8)';
            } else if (ratio >= 0.8) {
                countElement.style.background = 'rgba(255, 152, 0, 0.8)';
            } else {
                countElement.style.background = 'rgba(76, 175, 80, 0.8)';
            }
        }
    }
    
    // 设置当前回复的编号
    setCurrentReplyNumber(number) {
        this.currentReplyNumber = number;
    }
    
    // 添加特殊日志类型
    step(message, data = null) {
        this.addLog('step', message, data);
    }
    
    status(message, data = null) {
        this.addLog('status', message, data);
    }

    info(message, data) { this.addLog('info', message, data); }
    success(message, data) { this.addLog('success', message, data); }
    warning(message, data) { this.addLog('warning', message, data); }
    error(message, data) { this.addLog('error', message, data); }
    debug(message, data) { this.addLog('debug', message, data); }
    processing(message, data) { this.addLog('processing', message, data); }
    
    // 拖动功能
    setupDrag() {
        const header = this.panel.querySelector('#youtube-reply-log-header');
        
        header.addEventListener('mousedown', (e) => {
            // 如果正在拖动贴边按钮，不触发面板拖动
            if (this.isIndicatorDragging) return;
            
            // 标记开始拖动
            this.isDragging = true;
            
            // 计算鼠标相对于面板左上角的偏移
            const rect = this.panel.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            // 添加拖动样式
            this.panel.classList.add('dragging');
            
            // 立即将面板设置为fixed定位并保持当前位置
            this.panel.style.left = rect.left + 'px';
            this.panel.style.top = rect.top + 'px';
            
            // 防止文本选择
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                // 计算新的位置
                const x = e.clientX - this.dragOffset.x;
                const y = e.clientY - this.dragOffset.y;
                
                // 限制在窗口范围内
                const maxX = window.innerWidth - this.panel.offsetWidth;
                const maxY = window.innerHeight - this.panel.offsetHeight;
                
                // 更新面板位置
                this.panel.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
                this.panel.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.panel.classList.remove('dragging');
                
                // 如果面板被拖动到其他位置，记住这个位置
                if (this.panel.style.left && this.panel.style.top) {
                    this.isPositioned = true;
                    // 设置内联样式以确保面板保持可见
                    this.panel.style.cssText += '; display: flex !important; opacity: 1 !important;';
                }
            }
        });
    }
}

// Create global log instance
window.youtubeReplyLog = new FloatingLogWindow();

// Export for use in other scripts
window.youtubeReplyLog.version = '1.0.0';