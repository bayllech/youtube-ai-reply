// Background script for handling API calls and storage
class YouTubeAIReply {
  constructor() {
    this.conversationCache = null; // 缓存对话历史
    this.initializeAPI();
  }

  async initializeAPI() {
    // 初始化默认设置（不再包含预置回复和跳过规则）
    const defaultSettings = {
      enabled: false,
      apiKey: '',
      replyDelay: 3000,
      replyStyle: 'friendly',
      maxRepliesPerSession: 10,
      autoReplyEnabled: false,
      autoRefreshEnabled: true,
      aiRole: `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`
    };

    // Set default settings if not exists
    const result = await chrome.storage.sync.get(['settings']);
    if (!result.settings) {
      await chrome.storage.sync.set({ settings: defaultSettings });
    } else {
      // 合并现有设置与默认设置，确保新字段能够添加
      const mergedSettings = { ...defaultSettings, ...result.settings };
      await chrome.storage.sync.set({ settings: mergedSettings });
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

      // 检查是否有缓存的对话历史
      if (!this.conversationCache) {
        // 第一次调用，发送完整的角色设定
        const systemPrompt = this.buildSystemPrompt(config);
        const firstPrompt = this.buildFirstPrompt(commentText, replyStyle);
        
        const messages = [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user", 
            content: firstPrompt
          }
        ];
        
        const response = await this.callAPI(apiKey, messages);
        
        // 缓存对话历史（包含系统设定和第一次对话）
        this.conversationCache = [
          messages[0],
          messages[1],
          {
            role: "assistant",
            content: response.reply
          }
        ];
        
        return response;
      } else {
        // 后续调用，使用简化的prompt和缓存的对话历史
        const simplePrompt = this.buildSimplePrompt(commentText, replyStyle);
        const messages = [
          ...this.conversationCache,
          {
            role: "user",
            content: simplePrompt
          }
        ];
        
        const response = await this.callAPI(apiKey, messages);
        
        // 更新缓存（保持最近10轮对话以避免token过长）
        this.conversationCache.push({
          role: "user",
          content: simplePrompt
        }, {
          role: "assistant", 
          content: response.reply
        });
        
        // 如果对话历史过长，只保留最近的对话（保留系统提示 + 最近9轮）
        if (this.conversationCache.length > 11) {
          this.conversationCache = [
            this.conversationCache[0], // 保留系统提示
            ...this.conversationCache.slice(-10) // 保留最近10轮对话
          ];
        }
        
        return response;
      }
    } catch (error) {
      console.error('Error generating reply:', error);
      throw error;
    }
  }

  // 调用API的通用方法
  async callAPI(apiKey, messages) {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "glm-4.5-air",
        messages: messages
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const aiResponse = data.choices[0].message.content.trim();
    
    // 尝试解析JSON响应
    try {
      // 处理可能的markdown格式
      let jsonStr = aiResponse;
      if (aiResponse.startsWith('```json')) {
        jsonStr = aiResponse.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (aiResponse.startsWith('```')) {
        jsonStr = aiResponse.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      const parsed = JSON.parse(jsonStr.trim());
      return {
        reply: parsed.reply,
        quality: parsed.quality,
        actions: parsed.actions || []
      };
    } catch (parseError) {
      // 如果解析失败，返回原始回复内容（兼容性处理）
      console.warn('Failed to parse AI response as JSON, using fallback:', parseError);
      console.warn('AI response was:', aiResponse);
      return {
        reply: aiResponse,
        quality: 'average',
        actions: []
      };
    }
  }

  // 构建系统提示（只在第一次调用时使用）
  buildSystemPrompt(config) {
    const userRole = config?.aiRole || `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`;
    
    return `${userRole}

重要：你必须严格按照以下JSON格式回复所有评论：
{
  "reply": "你的回复内容",
  "quality": "excellent|good|average",
  "actions": ["like", "heart"]
}`;
  }

  // 构建第一次调用的完整prompt
  buildFirstPrompt(commentText, style) {
    const stylePrompts = {
      friendly: 'Please reply to this YouTube comment in a friendly and polite way. Keep your reply natural, helpful, and very short (under 20 words).',
      professional: 'Please reply to this YouTube comment in a professional and formal way. Keep your reply constructive and professional. Keep it very short (under 20 words).',
      casual: 'Please reply to this YouTube comment in a casual and relaxed way. Keep your reply natural and conversational. Keep it very short (under 20 words).',
      humorous: 'Please reply to this YouTube comment in a humorous way. Keep your reply witty but not offensive. Keep it very short (under 20 words).'
    };

    return `${stylePrompts[style] || stylePrompts.friendly}

Original comment: "${commentText}"

质量评估标准：
- excellent: 评论内容深入、有见解、表达真诚或极具创意
- good: 评论积极正面、表达支持或简单但有意义的反馈  
- average: 普通评论、简单表达或内容较少

操作规则：
- excellent质量：同时点赞和点红心 ["like", "heart"]
- good质量：只点赞 ["like"]
- average质量：不进行任何操作 []`;
  }

  // 构建简化的后续调用prompt
  buildSimplePrompt(commentText, style) {
    const styleKeywords = {
      friendly: '友好礼貌',
      professional: '正式专业', 
      casual: '轻松随意',
      humorous: '幽默风趣'
    };

    return `评论：${commentText}

请以${styleKeywords[style] || '友好礼貌'}的语气回复这条评论，要求：
1. 保持简短（20词以内）
2. 适当加入emoji表情
3. 以Bella第一人称回复

质量评估：
- excellent: 深入有见解的内容
- good: 积极正面的反馈
- average: 普通简单的评论`;
  }

  // 重置对话缓存（页面刷新时调用）
  resetConversationCache() {
    this.conversationCache = null;
    console.log('对话缓存已重置');
  }

  // Check if auto-reply is enabled
  async isAutoReplyEnabled() {
    const settings = await chrome.storage.sync.get(['settings']);
    return settings.settings?.autoReplyEnabled || false;
  }

  // Get reply settings
  async getReplySettings() {
    const settings = await chrome.storage.sync.get(['settings']);
    const userSettings = settings.settings || {};
    
    // 确保包含所有必要的字段，如果缺失则使用默认值
    const defaultSettings = {
      enabled: false,
      apiKey: '',
      replyDelay: 3000,
      replyStyle: 'friendly',
      maxRepliesPerSession: 10,
      autoReplyEnabled: false,
      autoRefreshEnabled: true,
      aiRole: `我的频道内容是关于AI MUSIC的，一位AI美女歌手演唱，歌手名叫Bella，来自瑞典，年龄25岁。
你是一个友好的AI助手，会根据频道评论内容,以Bella第一人称角度生成合适的回复。
1.回复的文本在可以适当加入emoji表情
2.无法理解的直接回复一颗💗`
    };
    
    return { ...defaultSettings, ...userSettings };
  }
}

// Initialize the background script
const youtubeAIReply = new YouTubeAIReply();

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'generateReply':
      // 使用立即执行函数避免消息通道问题
      (async () => {
        try {
          // 添加超时处理
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('API请求超时')), 30000);
          });
          
          const reply = await Promise.race([
            youtubeAIReply.generateReply(request.commentText, request.replyStyle),
            timeoutPromise
          ]);
          
          sendResponse({ success: true, reply });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
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
      // 重置对话缓存，使新的aiRole配置立即生效
      youtubeAIReply.resetConversationCache();
      sendResponse({ success: true });
      break;
      
    case 'saveSettings':
      // 保存设置
      (async () => {
        try {
          await chrome.storage.sync.set({ settings: request.settings });
          // 重置对话缓存，使新的aiRole配置立即生效
          youtubeAIReply.resetConversationCache();
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;

    case 'resetConversationCache':
      // 重置对话缓存
      youtubeAIReply.resetConversationCache();
      sendResponse({ success: true });
      break;
  }
});

console.log('YouTube AI Reply background script loaded');