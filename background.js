// Background script for handling API calls and storage
class YouTubeAIReply {
  constructor() {
    this.initializeAPI();
  }

  async initializeAPI() {
    // Initialize with default settings
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

    // Set default settings if not exists
    const result = await chrome.storage.sync.get(['settings']);
    if (!result.settings) {
      await chrome.storage.sync.set({ settings: defaultSettings });
    }
  }

  // Generate AI reply using Zhipu AI API
  async generateReply(commentText, replyStyle = 'friendly') {
    try {
      const settings = await chrome.storage.sync.get(['settings']);
      const config = settings.settings;
      const apiKey = config?.apiKey;
      
      if (!apiKey) {
        throw new Error('API key not configured');
      }

      // 检查是否应该使用预置回复
      if (this.shouldUsePresetReply(commentText, config)) {
        return this.getRandomPresetReply(config);
      }

      // 使用AI生成回复
      const prompt = this.buildPrompt(commentText, replyStyle, config);
      
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "glm-4.5-air",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const reply = data.choices[0].message.content;
      return reply.trim();

    } catch (error) {
      console.error('Error generating reply:', error);
      throw error;
    }
  }

  // 检查是否应该使用预置回复
  shouldUsePresetReply(commentText, config) {
    if (!config.localReplyRules || !config.presetReplies || config.presetReplies.length === 0) {
      return false;
    }

    const text = commentText.trim();
    
    // 检查是否符合本地回复规则
    return config.localReplyRules.some(rule => {
      switch(rule) {
        case '纯表情符号':
          return /^[\s\S]*?[\p{Emoji_Presentation}\p{Emoji}\u200D]+[\s\S]*?$/u.test(text) && text.length < 10;
        case '单个字或标点':
          return text.length <= 2 && /[\u4e00-\u9fa5\w]/.test(text);
        case '无意义的字符':
          return /^[a-zA-Z0-9\s\W]*$/.test(text) && text.length < 5;
        case '英文评论':
          return /^[a-zA-Z\s\W]+$/.test(text) && text.length > 0;
        case '数字评论':
          return /^[0-9]+$/.test(text);
        case '链接评论':
          return /http|www\.|\.com|\.cn|\.net/.test(text);
        case '太短的评论':
          return text.length < 5;
        case '太长的评论':
          return text.length > 100;
        case '重复内容':
          return /(.)\1{4,}/.test(text); // 检测连续重复的字符
        default:
          // 尝试匹配自定义规则描述中的关键词
          if (rule.includes('表情')) return /^[\s\S]*?[\p{Emoji_Presentation}\p{Emoji}\u200D]+[\s\S]*?$/u.test(text);
          if (rule.includes('英文') || rule.includes('English')) return /^[a-zA-Z\s\W]+$/.test(text);
          if (rule.includes('数字')) return /^[0-9\s]+$/.test(text);
          if (rule.includes('链接') || rule.includes('http')) return /http|www\.|\.com|\.cn|\.net/.test(text);
          if (rule.includes('短') || rule.includes('少')) return text.length < 5;
          if (rule.includes('长') || rule.includes('多')) return text.length > 100;
          return false;
      }
    });
  }

  // 获取随机预置回复
  getRandomPresetReply(config) {
    const replies = config.presetReplies;
    if (!replies || replies.length === 0) {
      return '感谢你的评论！💖'; // 默认回复
    }
    return replies[Math.floor(Math.random() * replies.length)];
  }

  buildPrompt(commentText, style, config) {
    const aiRole = config?.aiRole || `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`;

    const stylePrompts = {
      friendly: 'Please reply to this YouTube comment in a friendly and polite way. Keep your reply natural, helpful, and very short (under 20 words).',
      professional: 'Please reply to this YouTube comment in a professional and formal way. Keep your reply constructive and professional. Keep it very short (under 20 words).',
      casual: 'Please reply to this YouTube comment in a casual and relaxed way. Keep your reply natural and conversational. Keep it very short (under 20 words).',
      humorous: 'Please reply to this YouTube comment in a humorous way. Keep your reply witty but not offensive. Keep it very short (under 20 words).'
    };

    return `${aiRole}

${stylePrompts[style] || stylePrompts.friendly}

Original comment: "${commentText}"

Please reply with the response content only, and keep it very short. Do not add any other text.`;
  }

  // Check if auto-reply is enabled
  async isAutoReplyEnabled() {
    const settings = await chrome.storage.sync.get(['settings']);
    return settings.settings?.autoReplyEnabled || false;
  }

  // Get reply settings
  async getReplySettings() {
    const settings = await chrome.storage.sync.get(['settings']);
    return settings.settings || {};
  }
}

// Initialize the background script
const youtubeAIReply = new YouTubeAIReply();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'generateReply':
      youtubeAIReply.generateReply(request.commentText, request.replyStyle)
        .then(reply => sendResponse({ success: true, reply }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response

    case 'getSettings':
      youtubeAIReply.getReplySettings()
        .then(settings => sendResponse({ success: true, settings }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'isAutoReplyEnabled':
      youtubeAIReply.isAutoReplyEnabled()
        .then(enabled => sendResponse({ success: true, enabled }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'settingsUpdated':
      // 处理设置更新
      console.log('Settings updated:', request.settings);
      sendResponse({ success: true });
      break;
  }
});

console.log('YouTube AI Reply background script loaded');