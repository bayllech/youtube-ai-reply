// Popup script for YouTube AI Reply
class PopupManager {
  constructor() {
    this.settings = null;
    this.init();
  }

  async init() {
    console.log('Popup initialized');
    
    // Check if DOM elements exist
    const container = document.querySelector('.container');
    const header = document.querySelector('.header');
    console.log('DOM elements found:');
    console.log('container exists:', !!container);
    console.log('header exists:', !!header);
    console.log('container HTML:', container ? container.innerHTML.substring(0, 100) : 'null');
    console.log('document.body children:', document.body.children.length);
    console.log('HTML structure:');
    console.log(document.documentElement.outerHTML);
    
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
        console.log('Settings loaded:', this.settings);
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

    // API Key save button
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    if (saveApiKeyBtn) {
      saveApiKeyBtn.addEventListener('click', () => {
        this.saveApiKey();
      });
    }

    // Reply style change
    const replyStyleSelect = document.getElementById('replyStyle');
    if (replyStyleSelect) {
      replyStyleSelect.addEventListener('change', (e) => {
        this.updateSetting('replyStyle', e.target.value);
      });
    }

    // Reply delay change
    const replyDelayInput = document.getElementById('replyDelay');
    if (replyDelayInput) {
      replyDelayInput.addEventListener('change', (e) => {
        this.updateSetting('replyDelay', parseInt(e.target.value));
      });
    }

    // Max replies change
    const maxRepliesInput = document.getElementById('maxReplies');
    if (maxRepliesInput) {
      maxRepliesInput.addEventListener('change', (e) => {
        this.updateSetting('maxRepliesPerSession', parseInt(e.target.value));
      });
    }

    // Test API button
    const testApiBtn = document.getElementById('testApi');
    if (testApiBtn) {
      testApiBtn.addEventListener('click', () => {
        this.testApi();
      });
    }

    // Reset settings button
    const resetSettingsBtn = document.getElementById('resetSettings');
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }

    // Clear stats button
    const clearStatsBtn = document.getElementById('clearStats');
    if (clearStatsBtn) {
      clearStatsBtn.addEventListener('click', () => {
        this.clearStatistics();
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

    // Update API key field
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) {
      apiKeyInput.value = this.settings.apiKey || '';
    }

    // Update reply style
    const replyStyleSelect = document.getElementById('replyStyle');
    if (replyStyleSelect) {
      replyStyleSelect.value = this.settings.replyStyle || 'friendly';
    }

    // Update reply delay
    const replyDelayInput = document.getElementById('replyDelay');
    if (replyDelayInput) {
      replyDelayInput.value = this.settings.replyDelay || 3000;
    }

    // Update max replies
    const maxRepliesInput = document.getElementById('maxReplies');
    if (maxRepliesInput) {
      maxRepliesInput.value = this.settings.maxRepliesPerSession || 10;
    }
  }

  async updateSetting(key, value) {
    try {
      this.settings[key] = value;
      await chrome.storage.sync.set({ settings: this.settings });
      console.log(`Setting updated: ${key} = ${value}`);
      this.showNotification('设置已保存', 'success');
    } catch (error) {
      console.error('Error updating setting:', error);
      this.showNotification('保存设置失败', 'error');
    }
  }

  async saveApiKey() {
    const apiKeyInput = document.getElementById('apiKey');
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      this.showNotification('请输入API密钥', 'error');
      return;
    }

    // Basic validation (Gemini API keys typically start with 'AIza')
    if (!apiKey.startsWith('AIza')) {
      this.showNotification('API密钥格式不正确', 'error');
      return;
    }

    try {
      await this.updateSetting('apiKey', apiKey);
      this.showNotification('API密钥已保存', 'success');
      
      // Test the API key
      setTimeout(() => {
        this.testApi();
      }, 1000);
    } catch (error) {
      console.error('Error saving API key:', error);
      this.showNotification('保存API密钥失败', 'error');
    }
  }

  async testApi() {
    const testApiBtn = document.getElementById('testApi');
    const apiStatus = document.getElementById('apiStatus');
    
    testApiBtn.disabled = true;
    testApiBtn.textContent = '测试中...';
    apiStatus.textContent = '测试中...';
    apiStatus.className = 'status-value testing';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'generateReply',
        commentText: 'Hello, this is a test comment.',
        replyStyle: 'friendly'
      });

      if (response.success) {
        apiStatus.textContent = '正常';
        apiStatus.className = 'status-value success';
        this.showNotification('API测试成功', 'success');
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('API test failed:', error);
      apiStatus.textContent = '错误';
      apiStatus.className = 'status-value error';
      this.showNotification('API测试失败: ' + error.message, 'error');
    } finally {
      testApiBtn.disabled = false;
      testApiBtn.textContent = '测试API';
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

  async resetSettings() {
    if (!confirm('确定要重置所有设置吗？此操作不可撤销。')) {
      return;
    }

    try {
      const defaultSettings = {
        enabled: false,
        apiKey: '',
        replyDelay: 3000,
        replyStyle: 'friendly',
        maxRepliesPerSession: 10,
        autoReplyEnabled: false
      };

      this.settings = defaultSettings;
      await chrome.storage.sync.set({ settings: defaultSettings });
      this.updateUI();
      this.showNotification('设置已重置', 'success');
    } catch (error) {
      console.error('Error resetting settings:', error);
      this.showNotification('重置设置失败', 'error');
    }
  }

  async checkApiStatus() {
    const apiStatus = document.getElementById('apiStatus');
    
    if (!this.settings || !this.settings.apiKey) {
      apiStatus.textContent = '未配置';
      apiStatus.className = 'status-value warning';
      return;
    }

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro?key=${this.settings.apiKey}`, {
        method: 'GET'
      });

      if (response.ok) {
        apiStatus.textContent = '正常';
        apiStatus.className = 'status-value success';
      } else {
        throw new Error('API key invalid');
      }
    } catch (error) {
      apiStatus.textContent = '错误';
      apiStatus.className = 'status-value error';
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
    console.log('Forcing visibility of all sections...');
    
    // Force container and all sections to be visible
    const container = document.querySelector('.container');
    const sections = document.querySelectorAll('.settings-section, .status-section, .actions-section, .help-section');
    
    if (container) {
      container.style.display = 'block';
      container.style.visibility = 'visible';
      container.style.opacity = '1';
      console.log('Container forced visible');
    }
    
    sections.forEach((section, index) => {
      section.style.display = 'block';
      section.style.visibility = 'visible';
      section.style.opacity = '1';
      console.log(`Section ${index} forced visible`);
    });
    
    // Log the container HTML after forcing visibility
    setTimeout(() => {
      console.log('Container HTML after force visibility:', container ? container.innerHTML.substring(0, 200) : 'null');
    }, 100);
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