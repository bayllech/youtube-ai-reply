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
    const settingsLoaded = await this.loadSettings();
    
    // If settings failed to load, show error message
    if (!settingsLoaded) {
      const notification = document.getElementById('notification');
      const notificationText = document.getElementById('notificationText');
      if (notification && notificationText) {
        notificationText.textContent = '无法连接到扩展程序，请刷新页面重试';
        notification.className = 'notification error';
        notification.style.display = 'block';
      }
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Update UI
    this.updateUI();
  }

  async loadSettings() {
    // 添加重试机制，等待 background script 加载
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 200; // 200ms
    
    const tryLoadSettings = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response.success) {
          this.settings = response.settings;
          return true;
        } else {
          console.error('Failed to load settings:', response.error);
          return false;
        }
      } catch (error) {
        if (retryCount < maxRetries && error.message.includes('Could not establish connection')) {
          retryCount++;
          console.log(`Retrying connection to background script (${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return tryLoadSettings();
        } else {
          console.error('Error loading settings:', error);
          return false;
        }
      }
    };
    
    return await tryLoadSettings();
  }

  setupEventListeners() {
    // Auto-reply toggle
    const autoReplyToggle = document.getElementById('autoReplyEnabled');
    if (autoReplyToggle) {
      autoReplyToggle.addEventListener('change', (e) => {
        this.updateSetting('autoReplyEnabled', e.target.checked);
      });
    }

    // Auto-refresh toggle
    const autoRefreshToggle = document.getElementById('autoRefreshEnabled');
    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener('change', (e) => {
        this.updateSetting('autoRefreshEnabled', e.target.checked);
      });
    }

    // Open options button
    const openOptionsBtn = document.getElementById('openOptions');
    if (openOptionsBtn) {
      openOptionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }

    // Reset total count button
    const resetTotalBtn = document.getElementById('resetTotalCount');
    if (resetTotalBtn) {
      resetTotalBtn.addEventListener('click', () => {
        this.resetTotalCount();
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

    // Update auto-refresh toggle
    const autoRefreshToggle = document.getElementById('autoRefreshEnabled');
    if (autoRefreshToggle) {
      autoRefreshToggle.checked = this.settings.autoRefreshEnabled !== false;
    }
    
    // Update statistics
    this.updateStatistics();
  }

  async updateSetting(key, value) {
    try {
      this.settings[key] = value;
      await chrome.storage.sync.set({ settings: this.settings });
      this.showNotification('设置已保存', 'success');
      
      // 通知content script更新状态
      if (key === 'autoReplyEnabled') {
        this.notifyContentScript();
      } else if (key === 'autoRefreshEnabled') {
        this.notifyContentScriptSettingsChanged();
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

  async notifyContentScriptSettingsChanged() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'settingsChanged',
          settings: this.settings 
        });
      }
    } catch (error) {
      // Silent fail when notifying content script
    }
  }

  async clearStatistics() {
    try {
      await chrome.storage.local.remove(['replyCount']);
      this.showNotification('统计数据已清除', 'success');
    } catch (error) {
      console.error('Error clearing statistics:', error);
      this.showNotification('清除统计数据失败', 'error');
    }
  }

  async updateStatistics() {
    try {
      // Get reply counts from storage
      const result = await chrome.storage.local.get(['replyCount', 'totalReplyCount']);
      const replyCount = result.replyCount || {};
      const totalReplyCount = result.totalReplyCount || 0;
      
      // Calculate today's count
      const today = new Date().toDateString();
      const todayCount = replyCount[today] || 0;
      
      // Update UI
      const todayElement = document.getElementById('todayReplyCount');
      const totalElement = document.getElementById('totalReplyCount');
      
      if (todayElement) {
        todayElement.textContent = todayCount;
      }
      if (totalElement) {
        totalElement.textContent = totalReplyCount;
      }
    } catch (error) {
      console.error('Error updating statistics:', error);
    }
  }

  async resetTotalCount() {
    try {
      await chrome.storage.local.set({ totalReplyCount: 0 });
      this.updateStatistics();
      this.showNotification('累计回复数已重置', 'success');
    } catch (error) {
      console.error('Error resetting total count:', error);
      this.showNotification('重置失败', 'error');
    }
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

  forceVisibility() {
    // Force container and all sections to be visible
    const container = document.querySelector('.container');
    const sections = document.querySelectorAll('.settings-section, .actions-section, .stats-section, .help-section');
    
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