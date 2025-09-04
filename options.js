// Options page script for YouTube AI Reply
class OptionsManager {
  constructor() {
    this.settings = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.updateUI();
    this.setupEventListeners();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get('settings');
      this.settings = result.settings || this.getDefaultSettings();
      console.log('Settings loaded:', this.settings);
    } catch (error) {
      console.error('Error loading settings:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      apiKey: '',
      replyDelay: 3000,
      replyStyle: 'friendly',
      maxRepliesPerSession: 10,
      autoReplyEnabled: false,
      defaultReply: '🖤',
      emojiReply: '🤍🤍🩵🩵❤️❤️❤️‍🔥❤️‍🔥😻😻🌹🌹💓💓🫶🫶',
      aiRole: `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`
    };
  }

  updateUI() {
    // 更新基础设置
    document.getElementById('apiKey').value = this.settings.apiKey || '';
    document.getElementById('replyDelay').value = this.settings.replyDelay || 3000;
    document.getElementById('maxReplies').value = this.settings.maxRepliesPerSession || 10;
    document.getElementById('replyStyle').value = this.settings.replyStyle || 'friendly';
    document.getElementById('defaultReply').value = this.settings.defaultReply || '🖤';
    document.getElementById('emojiReply').value = this.settings.emojiReply || '🤍🤍🩵🩵❤️❤️❤️‍🔥❤️‍🔥😻😻🌹🌹💓💓🫶🫶';
    document.getElementById('aiRole').value = this.settings.aiRole || this.getDefaultSettings().aiRole;
    
  }


  setupEventListeners() {
    // 自动保存输入框内容
    document.getElementById('apiKey').addEventListener('input', (e) => {
      this.settings.apiKey = e.target.value;
    });
    
    document.getElementById('replyDelay').addEventListener('input', (e) => {
      this.settings.replyDelay = parseInt(e.target.value);
    });
    
    document.getElementById('maxReplies').addEventListener('input', (e) => {
      this.settings.maxRepliesPerSession = parseInt(e.target.value);
    });
    
    document.getElementById('replyStyle').addEventListener('change', (e) => {
      this.settings.replyStyle = e.target.value;
    });
    
    document.getElementById('aiRole').addEventListener('input', (e) => {
      this.settings.aiRole = e.target.value;
    });
    
    document.getElementById('defaultReply').addEventListener('input', (e) => {
      this.settings.defaultReply = e.target.value;
    });
    
    document.getElementById('emojiReply').addEventListener('input', (e) => {
      this.settings.emojiReply = e.target.value;
    });
    
    
    // 保存和重置按钮
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        this.saveSettings();
      });
    }
    
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }
  }


  async saveSettings() {
    try {
      await chrome.storage.sync.set({ settings: this.settings });
      this.showNotification('配置已保存', 'success');
      
      // 通知background script更新设置
      chrome.runtime.sendMessage({ action: 'settingsUpdated', settings: this.settings });
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showNotification('保存配置失败', 'error');
    }
  }

  async resetSettings() {
    if (!confirm('确定要重置所有设置吗？此操作不可撤销。')) {
      return;
    }
    
    this.settings = this.getDefaultSettings();
    this.updateUI();
    await this.saveSettings();
    this.showNotification('设置已重置为默认值', 'success');
  }

  showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  }
}

// 全局函数已移除，改为在setupEventListeners中绑定事件

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.optionsManager = new OptionsManager();
});