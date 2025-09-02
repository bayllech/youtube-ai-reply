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
      autoReplyEnabled: false
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
      const apiKey = settings.settings?.apiKey;
      
      if (!apiKey) {
        throw new Error('API key not configured');
      }

      const prompt = this.buildPrompt(commentText, replyStyle);
      
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

  buildPrompt(commentText, style) {
    const stylePrompts = {
      friendly: 'Please reply to this YouTube comment in a friendly and polite way. Keep your reply natural, helpful, and very short (under 20 words). Reply in English only.',
      professional: 'Please reply to this YouTube comment in a professional and formal way. Keep your reply constructive and professional. Keep it very short (under 20 words). Reply in English only.',
      casual: 'Please reply to this YouTube comment in a casual and relaxed way. Keep your reply natural and conversational. Keep it very short (under 20 words). Reply in English only.',
      humorous: 'Please reply to this YouTube comment in a humorous way. Keep your reply witty but not offensive. Keep it very short (under 20 words). Reply in English only.'
    };

    return `${stylePrompts[style] || stylePrompts.friendly}

Original comment: "${commentText}"

Please reply with the response content only, in English, and keep it very short. Do not add any other text.`;
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
  }
});

console.log('YouTube AI Reply background script loaded');