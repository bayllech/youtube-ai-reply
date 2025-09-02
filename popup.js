// Popup script for YouTube AI Reply
class PopupManager {
  constructor() {
    this.settings = null;
    this.init();
  }

  async init() {
    // Force all sections to be visible
    this.forceVisibility();
    
    // Load settings
    await this.loadSettings();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Update UI
    this.updateUI();
    
    // Load statistics
    this.loadStatistics();
    
    // Check API status
    this.checkApiStatus();
  }

  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response.success) {
        this.settings = response.settings;
      } else {
        console.error('Failed to load settings:', response.error);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  setupEventListeners() {
    // Auto-reply toggle
    const autoReplyToggle = document.getElementById('autoReplyEnabled');
    if (autoReplyToggle) {
      autoReplyToggle.addEventListener('change', (e) => {
        this.updateSetting('autoReplyEnabled', e.target.checked);
      });
    }

    // Open options button
    const openOptionsBtn = document.getElementById('openOptions');
    if (openOptionsBtn) {
      openOptionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }

    // Clear stats button
    const clearStatsBtn = document.getElementById('clearStats');
    if (clearStatsBtn) {
      clearStatsBtn.addEventListener('click', () => {
        this.clearStatistics();
      });
    }

    
    // Test connection button
    const testConnectionBtn = document.getElementById('testConnection');
    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', () => {
        this.testConnection();
      });
    }

    // Close notification button
    const closeNotificationBtn = document.getElementById('closeNotification');
    if (closeNotificationBtn) {
      closeNotificationBtn.addEventListener('click', () => {
        this.hideNotification();
      });
    }
  }

  updateUI() {
    if (!this.settings) return;

    // Update auto-reply toggle
    const autoReplyToggle = document.getElementById('autoReplyEnabled');
    if (autoReplyToggle) {
      autoReplyToggle.checked = this.settings.autoReplyEnabled || false;
    }
  }

  async updateSetting(key, value) {
    try {
      this.settings[key] = value;
      await chrome.storage.sync.set({ settings: this.settings });
      this.showNotification('设置已保存', 'success');
      
      // 通知content script更新状态
      if (key === 'autoReplyEnabled') {
        this.notifyContentScript();
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      this.showNotification('保存设置失败', 'error');
    }
  }

  async notifyContentScript() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'autoReplyToggled',
          enabled: this.settings.autoReplyEnabled 
        });
      }
    } catch (error) {
      // Silent fail when notifying content script
    }
  }

  async loadStatistics() {
    try {
      const today = new Date().toDateString();
      const result = await chrome.storage.local.get(['replyCount']);
      const replyCount = result.replyCount || {};
      const todayCount = replyCount[today] || 0;
      
      const todayRepliesElement = document.getElementById('todayReplies');
      if (todayRepliesElement) {
        todayRepliesElement.textContent = todayCount;
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  }

  async clearStatistics() {
    try {
      await chrome.storage.local.remove(['replyCount']);
      this.loadStatistics();
      this.showNotification('统计数据已清除', 'success');
    } catch (error) {
      console.error('Error clearing statistics:', error);
      this.showNotification('清除统计数据失败', 'error');
    }
  }

  async checkApiStatus() {
    const apiStatus = document.getElementById('apiStatus');
    
    if (!this.settings || !this.settings.apiKey) {
      apiStatus.textContent = '未配置';
      apiStatus.className = 'status-value warning';
      return;
    }

    // 简单检查API密钥是否存在
    apiStatus.textContent = '已配置';
    apiStatus.className = 'status-value success';
  }

  showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    
    notificationText.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';

    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.hideNotification();
    }, 3000);
  }

  hideNotification() {
    const notification = document.getElementById('notification');
    notification.style.display = 'none';
  }

  // 测试连接功能
  async testConnection() {
    console.log('=== 开始连接测试 ===');
    
    // 1. 测试与 background script 的连接
    try {
      console.log('测试 background script 连接...');
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response && response.success) {
        console.log('✅ Background script 连接成功');
        console.log('当前设置:', response.settings);
        
        // 测试存储
        console.log('测试存储功能...');
        await chrome.storage.sync.set({ test: 'test_value' });
        const result = await chrome.storage.sync.get('test');
        if (result.test === 'test_value') {
          console.log('✅ 存储功能正常');
          await chrome.storage.sync.remove('test');
        }
      } else {
        console.error('❌ Background script 连接失败');
      }
    } catch (error) {
      console.error('❌ Background script 测试失败:', error);
    }
    
    // 2. 测试与 content script 的连接
    try {
      console.log('测试 content script 连接...');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes('youtube.com')) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        if (response && response.success) {
          console.log('✅ Content script 连接成功');
        } else {
          console.log('⚠️ Content script 未响应');
        }
      } else {
        console.log('⚠️ 当前不是 YouTube 页面');
      }
    } catch (error) {
      console.log('⚠️ Content script 连接失败 (可能未加载):', error.message);
    }
    
    // 3. 测试权限
    console.log('测试权限...');
    try {
      const permissions = await chrome.permissions.getAll();
      console.log('✅ 当前权限:', permissions.permissions);
      console.log('✅ 主机权限:', permissions.origins);
    } catch (error) {
      console.error('❌ 权限检查失败:', error);
    }
    
    // 4. 测试日志窗口
    console.log('测试日志窗口功能...');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes('youtube.com')) {
        // 检查是否可以注入脚本
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            console.log('脚本注入测试成功');
            
            // 检查日志窗口是否存在
            const existingLog = document.getElementById('simple-youtube-log-window') || 
                              document.getElementById('youtube-reply-log-window');
            console.log('现有日志窗口检查:', existingLog ? '找到' : '未找到');
            
            return {
              injection: 'success',
              existingLog: !!existingLog
            };
          }
        });
        console.log('✅ 脚本注入权限正常');
        
        // 测试实际的日志窗口创建
        console.log('测试创建日志窗口...');
        // 直接注入而不是调用 showLogWindow 以避免递归
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            console.log('=== 测试创建日志窗口 ===');
            const testDiv = document.createElement('div');
            testDiv.id = 'test-log-window';
            testDiv.style.cssText = `
              position: fixed;
              top: 50px;
              right: 50px;
              width: 300px;
              height: 100px;
              background: #4285f4;
              color: white;
              padding: 10px;
              z-index: 999999;
              border-radius: 5px;
            `;
            testDiv.innerHTML = '📋 测试日志窗口<br><small>3秒后自动消失</small>';
            document.body.appendChild(testDiv);
            
            setTimeout(() => {
              if (testDiv.parentNode) {
                testDiv.remove();
              }
            }, 3000);
          }
        });
        console.log('✅ 测试日志窗口创建命令已发送');
      }
    } catch (error) {
      console.error('❌ 日志窗口测试失败:', error);
    }
    
    console.log('=== 连接测试完成 ===');
    this.showNotification('连接测试已完成，请查看控制台', 'info');
  }

  forceVisibility() {
    // Force container and all sections to be visible
    const container = document.querySelector('.container');
    const sections = document.querySelectorAll('.settings-section, .status-section, .actions-section, .help-section');
    
    if (container) {
      container.style.display = 'block';
      container.style.visibility = 'visible';
      container.style.opacity = '1';
    }
    
    sections.forEach((section, index) => {
      section.style.display = 'block';
      section.style.visibility = 'visible';
      section.style.opacity = '1';
    });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing popup...');
  new PopupManager();
});

// Also initialize immediately if DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded from readyState, initializing popup...');
    new PopupManager();
  });
} else {
  console.log('DOM already loaded, initializing popup immediately...');
  new PopupManager();
}

console.log('Popup script loaded');