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

  // Generate AI reply using Gemini API
  async generateReply(commentText, replyStyle = 'friendly') {
    try {
      const settings = await chrome.storage.sync.get(['settings']);
      const apiKey = settings.settings?.apiKey;
      
      if (!apiKey) {
        throw new Error('API key not configured');
      }

      const prompt = this.buildPrompt(commentText, replyStyle);
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const reply = data.candidates[0].content.parts[0].text;
      return reply.trim();

    } catch (error) {
      console.error('Error generating reply:', error);
      throw error;
    }
  }

  buildPrompt(commentText, style) {
    const stylePrompts = {
      friendly: '请以友好、礼貌的方式回复这个YouTube评论。回复要自然、有帮助性，并且要简短。',
      professional: '请以专业、正式的方式回复这个YouTube评论。回复要有建设性，体现专业性。',
      casual: '请以轻松、随意的方式回复这个YouTube评论。回复要自然、口语化。',
      humorous: '请以幽默的方式回复这个YouTube评论。回复要风趣但不冒犯人。'
    };

    return `${stylePrompts[style] || stylePrompts.friendly}

原评论: "${commentText}"

请只回复回复内容，不要添加任何其他文字。`;
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