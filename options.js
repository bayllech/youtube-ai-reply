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
  }

  updateUI() {
    // 更新基础设置
    document.getElementById('apiKey').value = this.settings.apiKey || '';
    document.getElementById('replyDelay').value = this.settings.replyDelay || 3000;
    document.getElementById('maxReplies').value = this.settings.maxRepliesPerSession || 10;
    document.getElementById('replyStyle').value = this.settings.replyStyle || 'friendly';
    document.getElementById('aiRole').value = this.settings.aiRole || this.getDefaultSettings().aiRole;
    
    // 更新预置回复列表
    this.updatePresetReplies();
    
    // 更新本地回复规则列表
    this.updateLocalReplyRules();
  }

  updatePresetReplies() {
    const container = document.getElementById('presetReplies');
    container.innerHTML = '';
    
    if (this.settings.presetReplies && this.settings.presetReplies.length > 0) {
      this.settings.presetReplies.forEach((reply, index) => {
        const item = document.createElement('div');
        item.className = 'preset-item';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = reply;
        input.addEventListener('input', (e) => {
          this.updatePresetReply(index, e.target.value);
        });
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', () => {
          this.deletePresetReply(index);
        });
        
        item.appendChild(input);
        item.appendChild(deleteBtn);
        container.appendChild(item);
      });
    } else {
      container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 20px;">暂无预置回复</p>';
    }
  }

  updateLocalReplyRules() {
    const container = document.getElementById('skipRules');
    container.innerHTML = '';
    
    if (this.settings.localReplyRules && this.settings.localReplyRules.length > 0) {
      this.settings.localReplyRules.forEach((rule, index) => {
        const item = document.createElement('div');
        item.className = 'rule-item';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = rule;
        input.addEventListener('input', (e) => {
          this.updateLocalReplyRule(index, e.target.value);
        });
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', () => {
          this.deleteLocalReplyRule(index);
        });
        
        item.appendChild(input);
        item.appendChild(deleteBtn);
        container.appendChild(item);
      });
    } else {
      container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 20px;">暂无本地回复规则</p>';
    }
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
    
    // 预置回复相关
    const addPresetReplyBtn = document.getElementById('addPresetReplyBtn');
    if (addPresetReplyBtn) {
      addPresetReplyBtn.addEventListener('click', () => {
        this.addPresetReply();
      });
    }
    
    const newPresetReplyInput = document.getElementById('newPresetReply');
    if (newPresetReplyInput) {
      newPresetReplyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.addPresetReply();
        }
      });
    }
    
    // 示例回复点击
    document.querySelectorAll('.example-reply').forEach(span => {
      span.addEventListener('click', (e) => {
        const value = e.target.getAttribute('data-value');
        document.getElementById('newPresetReply').value = value;
        document.getElementById('newPresetReply').focus();
      });
    });
    
    // 本地回复规则相关
    const addSkipRuleBtn = document.getElementById('addSkipRuleBtn');
    if (addSkipRuleBtn) {
      addSkipRuleBtn.addEventListener('click', () => {
        this.addSelectedLocalReplyRule();
      });
    }
    
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

  async addPresetReply() {
    const input = document.getElementById('newPresetReply');
    const reply = input.value.trim();
    
    if (!reply) {
      this.showNotification('请输入预置回复内容', 'error');
      return;
    }
    
    if (reply.length < 2) {
      this.showNotification('预置回复内容太短', 'error');
      return;
    }
    
    if (!this.settings.presetReplies) {
      this.settings.presetReplies = [];
    }
    
    // 检查是否重复
    if (this.settings.presetReplies.includes(reply)) {
      this.showNotification('该预置回复已存在', 'warning');
      return;
    }
    
    this.settings.presetReplies.push(reply);
    input.value = '';
    this.updatePresetReplies();
    this.showNotification('预置回复已添加', 'success');
  }

  updatePresetReply(index, value) {
    if (this.settings.presetReplies && this.settings.presetReplies[index]) {
      this.settings.presetReplies[index] = value;
      // 显示编辑提示
      this.showNotification('预置回复已修改', 'info');
    }
  }

  deletePresetReply(index) {
    if (this.settings.presetReplies && this.settings.presetReplies[index]) {
      this.settings.presetReplies.splice(index, 1);
      this.updatePresetReplies();
      this.showNotification('预置回复已删除', 'success');
    }
  }

  async addLocalReplyRule() {
    const input = document.getElementById('newSkipRule');
    const rule = input.value.trim();
    
    if (!rule) {
      this.showNotification('请输入本地回复规则', 'error');
      return;
    }
    
    if (!this.settings.localReplyRules) {
      this.settings.localReplyRules = [];
    }
    
    this.settings.localReplyRules.push(rule);
    input.value = '';
    this.updateLocalReplyRules();
    this.showNotification('本地回复规则已添加', 'success');
  }

  updateLocalReplyRule(index, value) {
    if (this.settings.localReplyRules && this.settings.localReplyRules[index]) {
      this.settings.localReplyRules[index] = value;
      // 显示编辑提示
      this.showNotification('本地回复规则已修改', 'info');
    }
  }

  deleteLocalReplyRule(index) {
    if (this.settings.localReplyRules && this.settings.localReplyRules[index]) {
      this.settings.localReplyRules.splice(index, 1);
      this.updateLocalReplyRules();
      this.showNotification('本地回复规则已删除', 'success');
    }
  }

  addSelectedLocalReplyRule() {
    const select = document.getElementById('skipRuleSelect');
    const rule = select.value;
    
    if (!rule) {
      this.showNotification('请先选择一个本地回复规则', 'warning');
      return;
    }
    
    // 检查是否已存在
    if (this.settings.localReplyRules && this.settings.localReplyRules.includes(rule)) {
      this.showNotification('该规则已存在', 'warning');
      return;
    }
    
    if (!this.settings.localReplyRules) {
      this.settings.localReplyRules = [];
    }
    
    this.settings.localReplyRules.push(rule);
    select.value = ''; // 重置选择
    this.updateLocalReplyRules();
    this.showNotification(`已添加规则: ${rule}`, 'success');
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