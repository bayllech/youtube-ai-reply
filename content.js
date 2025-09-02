// Content script for YouTube comment detection and reply
class YouTubeCommentMonitor {
  constructor() {
    this.observer = null;
    this.processedComments = new Set();
    this.recentlyProcessed = new Set(); // For preventing rapid duplicate processing
    this.replyQueue = [];
    this.isProcessing = false;
    this.settings = null;
    this.lastProcessedTexts = new Map(); // Track recently processed texts by position
    this.isScrolling = false;
    this.lastScrollTime = 0;
    this.scrollCheckInterval = null;
    
    this.init();
  }

  async init() {
    // console.log('YouTube AI Reply content script loaded');
    
    // 初始化日志
    if (window.youtubeReplyLog) {
      window.youtubeReplyLog.info('=== 初始化 YouTube AI Reply ===');
      window.youtubeReplyLog.info('版本:', '1.0');
      window.youtubeReplyLog.info('页面URL:', window.location.href);
    } else {
      // console.log('youtubeReplyLog 未找到，日志功能不可用');
    }
    
    // Wait for settings to load
    const settingsLoaded = await this.loadSettings();
    if (!settingsLoaded) {
      // console.log('Settings failed to load, retrying in 2 seconds...');
      setTimeout(async () => {
        await this.loadSettings();
        this.startCommentMonitoring();
      }, 2000);
    } else {
      // Start monitoring for comments
      this.startCommentMonitoring();
    }
    
    // Listen for settings changes
    this.listenForSettingsChanges();
    
    // Setup scroll detection logging
    this.setupScrollDetection();
  }

  async loadSettings() {
    try {
      window.youtubeReplyLog?.debug('正在加载设置...');
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response && response.success) {
        // 复制设置，保持autoReplyEnabled的原始值
        this.settings = { ...response.settings };
        window.youtubeReplyLog?.info('设置已加载:', { autoReply: this.settings.autoReplyEnabled });
        return true;
      } else {
        window.youtubeReplyLog?.warning('加载设置失败，使用默认设置');
        // Set default settings
        this.settings = {
          autoReplyEnabled: false,
          apiKey: '',
          replyDelay: 3000,
          replyStyle: 'friendly',
          maxRepliesPerSession: 10
        };
        return false;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Set default settings
      this.settings = {
        autoReplyEnabled: false,
        apiKey: '',
        replyDelay: 3000,
        replyStyle: 'friendly',
        maxRepliesPerSession: 10
      };
      return false;
    }
  }

  listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        this.settings = changes.settings.newValue;
        window.youtubeReplyLog?.info('设置已更新:', { autoReply: this.settings.autoReplyEnabled });
      }
    });
  }

  startCommentMonitoring() {
    // Wait for comments section to load
    const waitForComments = () => {
      // Try multiple selectors for comments section
      const commentsSection = document.querySelector('#comments') || 
                             document.querySelector('#comments-section') ||
                             document.querySelector('ytcp-comments-section') ||
                             document.querySelector('.comments-section');
      
      if (commentsSection) {
        this.setupCommentObserver();
        // processExistingComments is now called in setupCommentObserver
      } else {
        // console.log('Waiting for comments section to load...');
        setTimeout(waitForComments, 1000);
      }
    };

    waitForComments();
  }

  setupCommentObserver() {
    // Try multiple selectors for comments section
    const commentsSection = document.querySelector('#comments') || 
                           document.querySelector('#comments-section') ||
                           document.querySelector('ytcp-comments-section') ||
                           document.querySelector('.comments-section');
    
    if (!commentsSection) {
      // console.log('Comments section not found, retrying in 1 second...');
      setTimeout(() => this.setupCommentObserver(), 1000);
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip UI elements that can't contain comments
            const tagName = node.tagName.toLowerCase();
            const skipTags = [
              'tp-yt-paper-ripple', 'yt-icon-button', 'svg', 'path', 'circle', 'button', 
              'ytcp-comment-button', 'ytcp-tooltip', 'ytcp-img-with-fallback', 'ytcp-icon-button',
              'tp-yt-iron-icon', 'dom-if', 'ytcp-comment-video-thumbnail'
            ];
            if (skipTags.includes(tagName)) {
              return;
            }
            
            // Look specifically for comment text elements
            if (node.id === 'content-text' || node.classList.contains('yt-core-attributed-string')) {
              const text = node.textContent || '';
              // Skip if this looks like our own reply or UI text
              if (text.trim().length > 10 && 
                  !text.includes('Reply') && 
                  !text.includes('Share') &&
                  !this.isOwnReply(text)) {
                // console.log('Found comment text:', text.substring(0, 50) + '...');
                this.processNewComment(node);
              }
            } else {
              // Look for comment text within the added node
              const commentTexts = node.querySelectorAll('#content-text, .yt-core-attributed-string');
              commentTexts.forEach(comment => {
                const text = comment.textContent || '';
                // Skip if this looks like our own reply or UI text
                if (text.trim().length > 10 && 
                    !text.includes('Reply') && 
                    !text.includes('Share') &&
                    !this.isOwnReply(text)) {
                  // console.log('Found comment text in container:', text.substring(0, 50) + '...');
                  this.processNewComment(comment);
                }
              });
            }
          }
        });
      });
    });

    this.observer.observe(commentsSection, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    // console.log('Comment observer started');
    // Process existing comments
    this.processExistingComments();
    
    // Start auto-scroll to load more comments
    this.startAutoScroll();
  }

  isCommentElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) return false;
    
    // Skip all YouTube Studio components and UI elements
    const tagName = element.tagName.toLowerCase();
    const skipTags = [
      'tp-yt-paper-ripple', 'yt-icon-button', 'svg', 'path', 'circle', 'button', 
      'ytcp-comment-button', 'ytcp-tooltip', 'ytcp-img-with-fallback', 'ytcp-icon-button',
      'tp-yt-iron-icon', 'dom-if', 'ytcp-comment-video-thumbnail'
    ];
    if (skipTags.includes(tagName)) {
      return false;
    }
    
    // Skip elements with these class names
    if (element.className && (
        element.className.includes('style-scope ytcp-') ||
        element.className.includes('video-thumbnail') ||
        element.className.includes('icon-button')
    )) {
      return false;
    }
    
    // Only log for elements that might actually be comments
    if ((element.id && element.id.includes('comment')) || 
        (element.className && element.className.includes('comment'))) {
      // console.log('Checking if element is comment:', element.tagName, element.id, element.className);
    }
    
    // Only accept elements that are actual comment text
    if (element.id === 'content-text' || element.classList.contains('yt-core-attributed-string')) {
      const text = element.textContent || '';
      return text.trim().length > 10 && !text.includes('Reply') && !text.includes('Share');
    }
    
    // For containers, check if they contain comment text
    const commentText = element.querySelector('#content-text, .yt-core-attributed-string');
    if (commentText) {
      const text = commentText.textContent || '';
      return text.trim().length > 10 && !text.includes('Reply') && !text.includes('Share');
    }
    
    return false;
  }

  processExistingComments() {
    try {
      // console.log('Processing existing comments...');
      const existingComments = document.querySelectorAll('ytd-comment-thread-renderer #content-text, ytd-comment-renderer #content-text, ytcp-comment #content-text, #content-text.yt-core-attributed-string');
      // console.log('Found', existingComments.length, 'existing comments');
      existingComments.forEach(comment => {
        // Only process if this looks like actual comment text and not our own reply
        const text = comment.textContent || '';
        if (text.trim().length > 10 && !this.isOwnReply(text)) {
          this.processNewComment(comment);
        }
      });
    } catch (error) {
      console.error('Error processing existing comments:', error);
    }
  }

  async processNewComment(commentElement) {
    try {
      // Ensure settings are loaded
      if (!this.settings) {
        window.youtubeReplyLog?.debug('设置未加载，正在加载...');
        await this.loadSettings();
      }
      
      const commentText = this.extractCommentText(commentElement);
      window.youtubeReplyLog?.processing(`处理评论: ${commentText?.substring(0, 30)}...`);
      
      window.youtubeReplyLog?.debug('自动回复状态:', { enabled: this.settings?.autoReplyEnabled, hasApiKey: !!this.settings?.apiKey });
      
      if (!this.settings?.autoReplyEnabled) {
        window.youtubeReplyLog?.debug('自动回复已禁用');
        return;
      }
      
      if (!this.settings?.apiKey) {
        window.youtubeReplyLog?.warning('未配置API密钥');
        return;
      }

      // Extract comment text was moved up
      
      if (!commentText || commentText.trim().length < 10) {
        window.youtubeReplyLog?.debug('评论太短，跳过');
        return;
      }

      // Check if we should skip this comment (short words, etc.)
      if (this.shouldSkipComment(commentText)) {
        window.youtubeReplyLog?.debug('跳过简单评论:', commentText.substring(0, 50));
        return;
      }

      // Check if this is an emoji-heavy comment
      if (this.isEmojiHeavy(commentText)) {
        // console.log('Emoji-heavy comment detected, will use emoji reply');
        // Don't return here, we'll handle it in the reply generation
      }

      // Get the position of the comment for better duplicate detection
      const position = this.getElementPosition(commentElement);
      
      // Check if we've recently processed a comment with the same text at this position
      const positionKey = Math.floor(position / 100); // Group positions in 100px chunks
      const textKey = this.simpleHash(commentText.substring(0, 50));
      const recentKey = `${positionKey}_${textKey}`;
      const now = Date.now();
      
      if (this.lastProcessedTexts.has(recentKey)) {
        const lastProcessed = this.lastProcessedTexts.get(recentKey);
        if (now - lastProcessed < 10000) { // 10 second debounce for same text in similar position
          // console.log('Comment recently processed at this position, skipping');
          return;
        }
      }
      
      // Update the last processed time
      this.lastProcessedTexts.set(recentKey, now);
      
      // Clean up old entries (keep only last minute)
      if (this.lastProcessedTexts.size > 100) {
        const cutoff = now - 60000;
        for (const [key, timestamp] of this.lastProcessedTexts.entries()) {
          if (timestamp < cutoff) {
            this.lastProcessedTexts.delete(key);
          }
        }
      }

      // Get comment ID to avoid duplicates
      const commentId = this.getCommentId(commentElement);
      
      // Skip if this is a reply
      if (commentId === 'reply_skip') {
        return;
      }
      
      // Check if we've already processed this comment
      if (this.processedComments.has(commentId)) {
        // console.log(`Comment ${commentId} already processed, skipping`);
        return;
      }
      
      // Also check by text content to be extra sure
      const textHash = this.simpleHash(commentText);
      if (this.processedComments.has(`text_${textHash}`)) {
        // console.log(`Comment with same text already processed, skipping`);
        return;
      }

      // console.log('New comment detected:', commentText.substring(0, 100) + '...');
      
      // Add to reply queue with position info - but DON'T mark as processed yet
      this.replyQueue.push({
        commentId,
        commentText,
        element: commentElement,
        timestamp: Date.now(),
        textHash,
        position
      });

      // Sort the queue by position (top to bottom)
      this.replyQueue.sort((a, b) => a.position - b.position);

      // Process reply queue
      this.processReplyQueue();
    } catch (error) {
      console.error('Error processing new comment:', error);
      console.error('Comment element:', commentElement);
    }
  }

  getCommentId(commentElement) {
    try {
      // Extract the actual comment text first
      const commentText = this.extractCommentText(commentElement);
      if (!commentText) {
        return `error_${Date.now()}`;
      }
      
      // Check if this is a reply (has is-reply attribute or is in reply section)
      const comment = commentElement.closest('#comment') || 
                     commentElement.closest('ytcp-comment') ||
                     commentElement.closest('ytd-comment-thread-renderer') ||
                     commentElement.closest('ytd-comment-renderer');
      
      // Skip if this is a reply
      if (comment && (comment.hasAttribute('is-reply') || 
                     comment.closest('.comment-thread-replies') ||
                     comment.closest('ytcp-comment-replies'))) {
        // console.log('Skipping reply element');
        return 'reply_skip';
      }
      
      if (comment) {
        // Try to get a stable ID from the comment element
        const id = comment.id ||
                  comment.getAttribute('data-comment-id') ||
                  comment.getAttribute('comment-id') ||
                  comment.getAttribute('data-id');
        
        if (id && id !== 'comment') {
          // Use the ID with a hash of the comment text
          const textHash = this.simpleHash(commentText.substring(0, 100));
          const uniqueId = `${id}_${textHash}`;
          // console.log('Generated comment ID:', uniqueId);
          return uniqueId;
        }
      }
      
      // If no stable ID found, use hash of comment text
      const textHash = this.simpleHash(commentText);
      const uniqueId = `comment_${textHash}`;
      // console.log('Generated hash-based comment ID:', uniqueId);
      return uniqueId;
    } catch (error) {
      console.error('Error getting comment ID:', error);
      return `error_${Date.now()}`;
    }
  }
  
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  getElementPosition(element) {
    // Get the Y position of the element relative to the document
    let yPos = 0;
    let tempElement = element;
    
    while (tempElement) {
      yPos += tempElement.offsetTop;
      tempElement = tempElement.offsetParent;
    }
    
    return yPos;
  }
  
  isOwnReply(text) {
    // Check if the text looks like our AI-generated reply
    const ownReplyPatterns = [
      '谢谢你的夸奖',
      '¡Gracias',
      'AI-generated reply',
      '很高兴你喜欢',
      'Me alegra que te guste',
      '感谢你的',
      'Thank you for'
    ];
    
    return ownReplyPatterns.some(pattern => text.includes(pattern));
  }

  isEmojiHeavy(text) {
    // Remove all emojis and check what's left
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}]|[\u{2020}]|[\u{2B06}]|[\u{2197}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{3297}]|[\u{3299}]|[\u{3030}]|[\u{2B50}]|[\u{2B55}]/gu;
    const textWithoutEmojis = text.replace(emojiRegex, '').trim();
    
    // If more than 50% of the comment is emojis or it's mostly emojis
    const emojiCount = (text.match(emojiRegex) || []).length;
    const totalLength = text.length;
    
    return emojiCount > 0 && (textWithoutEmojis.length < totalLength * 0.5 || emojiCount >= 3);
  }

  generateEmojiReply() {
    // Return positive emojis for emoji-heavy comments
    const emojiReplies = [
      '❤️❤️❤️',
      '🎉🎉🎉',
      '🙏🙏🙏',
      '💕💕💕',
      '😊😊😊',
      '👍👍👍',
      '🌟🌟🌟',
      '💖💖💖',
      '😄😄😄',
      '🎊🎊🎊'
    ];
    return emojiReplies[Math.floor(Math.random() * emojiReplies.length)];
  }

  shouldSkipComment(text) {
    // Skip very short comments that are just exclamations or single words
    const skipPatterns = [
      /^[a-zA-Z]{1,3}$/,  // Single words like "Wow", "AI", "ia", etc.
      /^[!?.,]{1,5}$/,    // Just punctuation
      /^(lol|wow|omg|wtf|idk|btw|imho)$/i,  // Common short acronyms
      /^(yes|no|ok|okay|nice|good|bad|cool)$/i,  // Simple reactions
      /^[ha]{2,}$/,       // Laughter like "haha"
      /^\s*$/            // Empty or whitespace only
    ];
    
    const trimmedText = text.trim();
    
    // Skip if text is less than 4 characters (after trimming)
    if (trimmedText.length < 4) {
      return true;
    }
    
    // Check against skip patterns
    for (const pattern of skipPatterns) {
      if (pattern.test(trimmedText)) {
        return true;
      }
    }
    
    return false;
  }

  async clickLikeButton(commentElement) {
    try {
      // Find the like button within the comment
      const commentContainer = commentElement.closest('ytcp-comment');
      if (!commentContainer) {

        return;
      }

      // Click the like button
      const likeButton = commentContainer.querySelector('#like-button ytcp-icon-button') ||
                        commentContainer.querySelector('#like-button button') ||
                        commentContainer.querySelector('ytcp-comment-toggle-button#like-button ytcp-icon-button');
      
      if (likeButton) {

        likeButton.click();

      } else {

      }

      // Also click the creator heart button
      const heartButton = commentContainer.querySelector('#creator-heart-button ytcp-icon-button') ||
                         commentContainer.querySelector('#creator-heart-button button') ||
                         commentContainer.querySelector('#creator-heart #creator-heart-button');
      
      if (heartButton) {

        heartButton.click();

      } else {

      }

    } catch (error) {
      console.error('Error clicking buttons:', error);
    }
  }

  extractCommentText(commentElement) {
    try {

      
      // If the element itself is the content-text element, use its text directly
      if (commentElement.id === 'content-text' || commentElement.classList.contains('yt-core-attributed-string')) {
        const text = commentElement.textContent.trim();

        return text;
      }
      
      // Find the comment text element using multiple selectors
      const textElement = commentElement.querySelector('#content-text') ||
                         commentElement.querySelector('.yt-core-attributed-string') ||
                         commentElement.querySelector('yt-formatted-string#content-text');
      
      if (textElement) {
        const text = textElement.textContent.trim();

        return text;
      }
      
      // If the element is yt-formatted-string with content-text id
      if (commentElement.tagName === 'YT-FORMATTED-STRING' && commentElement.id === 'content-text') {
        const text = commentElement.textContent.trim();

        return text;
      }
      
      // Last resort - use the element's text if it looks like a comment
      const text = commentElement.textContent.trim();
      if (text.length > 10 && !text.includes('Reply') && !text.includes('Share')) {

        return text;
      }
      
    } catch (error) {
      console.error('Error extracting comment text:', error);
      console.error('Comment element for debugging:', commentElement);
    }
    return '';
  }

  async processReplyQueue() {
    if (this.isProcessing || this.replyQueue.length === 0) {
      return;
    }

    this.isProcessing = true;


    while (this.replyQueue.length > 0) {
      const comment = this.replyQueue.shift();

      
      // Double check if this comment has already been processed
      if (this.processedComments.has(comment.commentId) || 
          this.processedComments.has(`text_${comment.textHash}`)) {

        continue;
      }
      
      // Mark as processed NOW - before we start replying
      this.processedComments.add(comment.commentId);
      this.processedComments.add(`text_${comment.textHash}`);
      
      // Check if we should reply to this comment
      if (await this.shouldReplyToComment(comment)) {
        await this.generateAndPostReply(comment);
      } else {

      }

      // Add delay between replies
      await this.sleep(this.settings?.replyDelay || 3000);
    }

    this.isProcessing = false;

  }

  async shouldReplyToComment(comment) {

    
    // Check if auto-reply is enabled
    if (!this.settings?.autoReplyEnabled) {

      this.stopAutoScroll();
      return false;
    }

    // Check reply limit
    if (this.settings?.maxRepliesPerSession) {
      const today = new Date().toDateString();
      const replyCount = await this.getTodayReplyCount();

      if (replyCount >= this.settings.maxRepliesPerSession) {

        this.stopAutoScroll();
        return false;
      }
    }

    // Avoid replying to very short comments
    if (comment.commentText.length < 10) {

      return false;
    }

    // Avoid replying to comments that might be spam
    const spamKeywords = ['subscribe', 'like', 'check out', 'visit my', 'my channel'];
    const lowerComment = comment.commentText.toLowerCase();
    if (spamKeywords.some(keyword => lowerComment.includes(keyword))) {

      return false;
    }


    return true;
  }

  async getTodayReplyCount() {
    return new Promise((resolve) => {
      const today = new Date().toDateString();
      chrome.storage.local.get(['replyCount'], (result) => {
        const countData = result.replyCount || {};
        resolve(countData[today] || 0);
      });
    });
  }

  async incrementReplyCount() {
    return new Promise((resolve) => {
      const today = new Date().toDateString();
      chrome.storage.local.get(['replyCount'], (result) => {
        const countData = result.replyCount || {};
        countData[today] = (countData[today] || 0) + 1;
        chrome.storage.local.set({ replyCount: countData }, resolve);
      });
    });
  }

  async generateAndPostReply(comment) {
    try {
      window.youtubeReplyLog?.info('正在生成回复...');
      window.youtubeReplyLog?.debug('评论内容:', comment.commentText.substring(0, 50));

      let replyText;
      
      // Check if this is an emoji-heavy comment and use emoji reply
      if (this.isEmojiHeavy(comment.commentText)) {
        replyText = this.generateEmojiReply();
        window.youtubeReplyLog?.info('生成表情回复:', replyText);
      } else {
        // Generate AI reply for regular comments
        window.youtubeReplyLog?.debug('请求AI生成回复...');
        const response = await chrome.runtime.sendMessage({
          action: 'generateReply',
          commentText: comment.commentText,
          replyStyle: this.settings?.replyStyle || 'friendly'
        });

        if (!response.success) {
          throw new Error(response.error);
        }

        replyText = response.reply;
        window.youtubeReplyLog?.success('AI回复已生成:', replyText);
      }

      // Post the reply
      await this.postReply(comment.element, replyText);

      // Click the like button for the comment
      await this.clickLikeButton(comment.element);

      // Increment reply count
      await this.incrementReplyCount();



    } catch (error) {
      console.error('Error generating/posting reply:', error);
    }
  }

  async postReply(commentElement, replyText) {
    try {
      window.youtubeReplyLog?.debug('正在发布回复...');
      window.youtubeReplyLog?.debug('回复内容:', replyText.substring(0, 50));
      
      // Find the reply button using multiple selectors
      const replyButton = this.findReplyButton(commentElement);
      
      if (!replyButton) {
        window.youtubeReplyLog?.error('未找到回复按钮');
        throw new Error('Reply button not found');
      }

      window.youtubeReplyLog?.debug('找到回复按钮，正在点击...');
      replyButton.click();
      await this.sleep(2000); // Increased delay for YouTube Studio

      // Find reply input box
      const replyInput = this.findReplyInput();
      
      if (!replyInput) {
        // Try to find the reply button again and click it once more
        window.youtubeReplyLog?.debug('未找到回复输入框，重试...');
        replyButton.click();
        await this.sleep(1500);
        
        // Try to find reply input again
        const retryInput = this.findReplyInput();
        if (!retryInput) {
          throw new Error('Reply input not found after retry');
        }

      }


      replyInput.focus();
      await this.typeText(replyInput, replyText);

      // Find and click post button
      const postButton = this.findPostButton();
      
      if (!postButton) {
        throw new Error('Post button not found');
      }


      postButton.click();
      
      // Wait for the reply to be posted
      await this.sleep(3000);
      
      // Check if the post was successful by looking for our reply text
      const postedSuccessfully = this.checkIfReplyWasPosted(replyText);
      
      if (postedSuccessfully) {

        
        // Only close the dialog if we're sure the reply was posted
        await this.sleep(1000); // Small delay before closing
        await this.closeReplyDialog();
      } else {

        await this.closeReplyDialog();
      }
      

      return true;

    } catch (error) {
      console.error('Error posting reply:', error);
      // Try to close any open dialogs
      await this.closeReplyDialog();
      // Log additional debugging information


      throw error;
    }
  }

  findReplyButton(commentElement) {
    const comment = commentElement.closest('#comment') || 
                   commentElement.closest('ytd-comment-thread-renderer') ||
                   commentElement.closest('ytd-comment-renderer') ||
                   commentElement.closest('ytcp-comment');
    
    if (!comment) {

      return null;
    }


    
    // Try multiple selectors for reply button, prioritizing YouTube Studio selectors
    const replyButton = comment.querySelector('ytcp-comment-button#reply-button button') ||
                        comment.querySelector('ytcp-comment-button#reply-button') ||
                        comment.querySelector('button[aria-label*="Reply"]') ||
                        comment.querySelector('button[aria-label*="reply"]') ||
                        comment.querySelector('button[aria-label*="回复"]') ||
                        comment.querySelector('button[title*="Reply"]') ||
                        comment.querySelector('button[title*="reply"]') ||
                        comment.querySelector('button[title*="回复"]') ||
                        comment.querySelector('.ytd-comment-action-buttons-renderer button') ||
                        comment.querySelector('#reply-button-end');
    
    if (replyButton) {

      return replyButton;
    } else {

      // Log the comment element for debugging

      return null;
    }
  }

  findReplyInput() {

    
    // Try to find the textarea in YouTube Studio comment box
    const input = document.querySelector('ytcp-commentbox tp-yt-iron-autogrow-textarea textarea') ||
                  document.querySelector('ytcp-commentbox textarea') ||
                  document.querySelector('tp-yt-iron-autogrow-textarea textarea') ||
                  document.querySelector('#reply-dialog-id textarea') ||
                  document.querySelector('#reply-dialog-container textarea') ||
                  document.querySelector('textarea[placeholder*="回复"]') ||
                  document.querySelector('textarea[placeholder*="添加回复"]') ||
                  document.querySelector('textarea[aria-label*="添加回复"]');
    
    if (input) {


      return input;
    }
    
    // Fallback to contenteditable divs for regular YouTube
    const allEditable = document.querySelectorAll('div[contenteditable="true"]');
    
    const fallbackInput = document.querySelector('ytcp-comment-simplebox-renderer div[contenteditable="true"]') ||
                         document.querySelector('ytd-comment-simplebox-renderer div[contenteditable="true"]') ||
                         document.querySelector('div[contenteditable="true"][role="textbox"]');
    
    if (fallbackInput) {

      return fallbackInput;
    }
    

    return null;
  }

  findPostButton() {

    
    // Try multiple selectors for post button, updated for YouTube Studio's structure
    const postButton = document.querySelector('ytcp-comment-button#submit-button ytcp-button-shape button') ||
                      document.querySelector('ytcp-comment-button#submit-button button') ||
                      document.querySelector('#submit-button ytcp-button-shape button') ||
                      document.querySelector('#submit-button button') ||
                      document.querySelector('ytcp-commentbox #submit-button button') ||
                      document.querySelector('ytcp-commentbox button[aria-label*="回复"]') ||
                      document.querySelector('ytcp-commentbox button[aria-label*="Comment"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="回复"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="Comment"]') ||
                      document.querySelector('ytcp-button-shape button[aria-label*="Post"]') ||
                      document.querySelector('button[aria-label*="回复"]') ||
                      document.querySelector('button[aria-label*="Comment"]') ||
                      document.querySelector('button[aria-label*="Post"]') ||
                      document.querySelector('button[aria-label*="发布"]') ||
                      document.querySelector('button#submit-button') ||
                      document.querySelector('button#submit-button-end');
    
    if (postButton) {


      return postButton;
    }
    
    // Log all buttons for debugging
    const allButtons = document.querySelectorAll('button');
    // All buttons found: allButtons.length
    
    // Try to find any button with "回复", "Comment", or "Post" in aria-label or text
    const buttonsWithText = Array.from(allButtons).filter(button => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const text = button.textContent || '';
      return ariaLabel.includes('回复') || ariaLabel.includes('Comment') || ariaLabel.includes('Post') ||
             text.includes('回复') || text.includes('Comment') || text.includes('Post');
    });
    
    if (buttonsWithText.length > 0) {

      // Return the last one (usually the post button appears last)
      return buttonsWithText[buttonsWithText.length - 1];
    }
    
    // Log all buttons for debugging
    allButtons.forEach((button, index) => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const text = button.textContent || '';
      if (ariaLabel || text) {

      }
    });
    

    return null;
  }

  async typeText(element, text) {

    
    // Wait a bit for the element to be fully ready
    await this.sleep(500);
    
    // Handle different element types
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // For YouTube Studio's tp-yt-iron-autogrow-textarea, we need to be more careful
      const ironTextarea = element.closest('tp-yt-iron-autogrow-textarea');
      if (ironTextarea) {
        // Use the iron component's API if available
        try {
          // Try to set the value using the property if it exists
          if (typeof ironTextarea.setValue === 'function') {
            ironTextarea.setValue(text);
          } else if (ironTextarea.bindValue !== undefined) {
            ironTextarea.bindValue = text;
          } else if (ironTextarea.value !== undefined) {
            ironTextarea.value = text;
          }
          
          // Update the native textarea element
          element.value = text;
          
          // Update the mirror div that shows the text
          const mirror = ironTextarea.querySelector('#mirror');
          if (mirror) {
            mirror.textContent = text;
          }
          
          // Trigger input event on the textarea element
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          
          // Trigger polymer events with proper composition
          setTimeout(() => {
            ironTextarea.dispatchEvent(new CustomEvent('value-changed', { 
              bubbles: true, 
              composed: true, 
              detail: { value: text } 
            }));
            ironTextarea.dispatchEvent(new CustomEvent('iron-input', { 
              bubbles: true, 
              composed: true 
            }));
          }, 50);
        } catch (error) {

          // Fallback: try direct input
          element.focus();
          element.value = text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        // For regular input/textarea elements
        element.focus();
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // For contenteditable divs
      element.focus();
      element.textContent = text;
      
      // Trigger input events
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      
      element.dispatchEvent(inputEvent);
      element.dispatchEvent(changeEvent);
    }
  }

  async closeReplyDialog() {
    try {

      
      // First, check if there's an active reply dialog and close it properly
      const activeDialog = document.querySelector('ytcp-commentbox[is-reply][keyboard-focus]');
      if (activeDialog) {

        
        // Try to find the cancel button within this specific dialog
        const cancelButton = activeDialog.querySelector('#cancel-button button') ||
                             activeDialog.querySelector('button[aria-label*="取消"]') ||
                             activeDialog.querySelector('ytcp-comment-button#cancel-button button');
        
        if (cancelButton) {

          cancelButton.click();
          await this.sleep(1000);
          return;
        }
        
        // If no cancel button, try to find the reply button that opened this dialog
        const commentContainer = activeDialog.closest('ytcp-comment');
        if (commentContainer) {
          const replyButton = commentContainer.querySelector('button[aria-label*="回复"]');
          if (replyButton) {

            replyButton.click();
            await this.sleep(1000);
            return;
          }
        }
      }
      
      // Fallback: try to find any cancel button
      const cancelButton = document.querySelector('ytcp-comment-button#cancel-button button') ||
                           document.querySelector('#cancel-button button') ||
                           document.querySelector('button[aria-label*="取消"]');
      
      if (cancelButton) {

        cancelButton.click();
        await this.sleep(1000);
        return;
      }
      
      // Try pressing Escape key

      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(escEvent);
      await this.sleep(500);
      
      // Check if dialog is still open
      const remainingDialog = document.querySelector('ytcp-commentbox[is-reply]');
      if (!remainingDialog) {

        return;
      }
      
      // Last resort - but be more careful about which reply button we click

      const replyButtons = Array.from(document.querySelectorAll('button[aria-label*="回复"]'));
      
      // Find a reply button that has an open dialog
      for (const button of replyButtons) {
        const commentContainer = button.closest('ytcp-comment');
        if (commentContainer && commentContainer.querySelector('ytcp-commentbox[is-reply]')) {

          button.click();
          await this.sleep(1000);
          break;
        }
      }
      

    } catch (error) {
      console.error('Error closing reply dialog:', error);
    }
  }

  checkIfReplyWasPosted(replyText) {
    try {
      // Look for the reply text in the document
      const textElements = document.querySelectorAll('#content-text, .yt-core-attributed-string');
      
      for (const element of textElements) {
        const text = element.textContent || '';
        // Check if this element contains our reply text
        if (text.includes(replyText.substring(0, 20)) && text.length >= replyText.length * 0.8) {
          // Check if this is a reply (not the original comment)
          const commentContainer = element.closest('ytcp-comment');
          if (commentContainer) {
            // Check if it has the 'is-reply' attribute or is inside a reply thread
            const isReply = commentContainer.hasAttribute('is-reply') || 
                           commentContainer.closest('.comment-thread-replies') !== null;
            if (isReply || element.closest('ytcp-comment[is-reply]')) {

              return true;
            }
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if reply was posted:', error);
      return false;
    }
  }

  async startAutoScroll() {

    
    // Check if we're already scrolling
    if (this.isScrolling) {
      return;
    }
    
    this.isScrolling = true;
    // Set lastScrollTime to 0 to allow immediate first scroll
    this.lastScrollTime = 0;
    this.scrollCheckInterval = setInterval(() => {
      this.checkAndScroll();
    }, 3000); // Check every 3 seconds
    
    // Also trigger an immediate scroll check after a short delay
    setTimeout(() => {
      this.checkAndScroll();
    }, 1000);
  }

  checkAndScroll() {
    try {

      
      // Don't scroll if we're currently processing replies
      if (this.isProcessing) {

        return;
      }
      
      // Check if we've reached the reply limit
      if (this.settings?.maxRepliesPerSession) {
        const today = new Date().toDateString();
        // We can't easily get the current count without async, so we'll just check the setting
        // The scrolling will be stopped when limit is reached in shouldReplyToComment
      }

      const now = Date.now();
      // Only scroll if it's been at least 5 seconds since the last scroll
      if (now - this.lastScrollTime < 5000) {

        return;
      }
      

      
      // Track if we've scrolled before to detect new content
      if (this.lastScrollHeight && this.activitySection) {
        const currentHeight = this.activitySection.scrollHeight;
        if (currentHeight > this.lastScrollHeight) {

          // Reset scroll position to continue scrolling
          this.lastScrollHeight = currentHeight;
        }
      }

      // Check if we need to scroll (look for various load more buttons)
      const loadMoreButton = document.querySelector('ytcp-button[aria-label*="Load more"], button[aria-label*="Load more"], ytcp-button[aria-label*="加载更多"], ytcp-button[aria-label*="更多"], button[aria-label*="更多"]');
      
      if (loadMoreButton) {

        loadMoreButton.click();
        this.lastScrollTime = now;
        return;
      }

      // Try to find and click any "Show more replies" buttons
      const showMoreButtons = document.querySelectorAll('ytcp-button[aria-label*="Show more replies"], button[aria-label*="Show more replies"], ytcp-button[aria-label*="显示更多回复"], ytcp-button[aria-label*="更多回复"]');
      if (showMoreButtons.length > 0) {

        showMoreButtons.forEach(button => {
          if (!button.clicked) {
            button.click();
            button.clicked = true;

          }
        });
        this.lastScrollTime = now;
        return;
      }

      // Check if we're at the bottom - prioritize YTCP-ACTIVITY-SECTION container
      let scrollContainer = null;
      let scrollTop = 0;
      let scrollHeight = 0;
      let clientHeight = 0;
      
      // First try YTCP-ACTIVITY-SECTION (YouTube Studio's main scroll container)
      const activitySection = document.querySelector('ytcp-activity-section');
      if (activitySection && activitySection.scrollHeight > activitySection.clientHeight) {
        scrollContainer = activitySection;
        scrollTop = activitySection.scrollTop;
        scrollHeight = activitySection.scrollHeight;
        clientHeight = activitySection.clientHeight;
        this.activitySection = activitySection;

      } else {
        // Fallback to other containers
        const containers = [
          document.querySelector('#primary-inner'),
          document.querySelector('#primary'),
          document.querySelector('#comments'),
          document.querySelector('ytd-comments'),
          document.querySelector('.ytcp-app'),
          document.querySelector('body'),
          document.documentElement
        ];
        
        // Debug: log all potential containers
        
        for (const container of containers) {
          if (container && container.scrollHeight > container.clientHeight) {
            scrollContainer = container;
            scrollTop = container.scrollTop;
            scrollHeight = container.scrollHeight;
            clientHeight = container.clientHeight;
            break;
          }
        }
      }
      
      // If no scrollable container found, use window
      if (!scrollContainer) {
        scrollTop = window.scrollY;
        scrollHeight = document.documentElement.scrollHeight;
        clientHeight = window.innerHeight;
        scrollContainer = window;

      }
      
      // If we're near the bottom or if we haven't scrolled much, scroll down
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      
      if (distanceFromBottom < 1500 || scrollTop < 500) {
        if (scrollContainer === window) {
          window.scrollBy(0, 1000);
        } else {
          scrollContainer.scrollTop += 1000;
        }
        this.lastScrollTime = now;
        this.lastScrollHeight = scrollHeight;

        return;
      }
      

    } catch (error) {
      console.error('Error in auto-scroll:', error);
    }
  }

  stopAutoScroll() {
    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
      this.scrollCheckInterval = null;
    }
    this.isScrolling = false;

  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Setup scroll detection to understand YouTube Studio scrolling
  setupScrollDetection() {

    
    // Monitor scroll events with capture phase
    const scrollTargets = [
      window,
      document,
      document.documentElement,
      document.body,
      document.querySelector('#primary-inner'),
      document.querySelector('#primary'),
      document.querySelector('#comments'),
      document.querySelector('#primary ytd-item-section-renderer'),
      document.querySelector('.ytcp-app'),
      document.querySelector('ytd-app')
    ].filter(Boolean);
    

    
    scrollTargets.forEach(target => {
      if (!target) return;
      
      // Use capture phase and passive: false
      target.addEventListener('scroll', (event) => {
        // Check for new comments after scroll
        setTimeout(() => {
          this.checkForNewCommentsAfterScroll();
        }, 1000);
      }, { capture: true, passive: false });
    });
    
    // Also monitor wheel events
    document.addEventListener('wheel', (event) => {
      // Wheel event detected
    }, { capture: true, passive: false });
    
    // Also monitor touch events for mobile
    document.addEventListener('touchmove', (event) => {
      // Touch move event detected
    }, { capture: true, passive: false });
    
    // Monitor scroll on the whole document with timeout
    let lastScrollTop = window.scrollY;
    setInterval(() => {
      const currentScrollTop = window.scrollY;
      if (currentScrollTop !== lastScrollTop) {
        lastScrollTop = currentScrollTop;
        this.checkForNewCommentsAfterScroll();
      }
    }, 100);
  }
  
  checkForNewCommentsAfterScroll() {
    // Check document dimensions
    const existingComments = document.querySelectorAll('ytd-comment-thread-renderer #content-text, ytd-comment-renderer #content-text, ytcp-comment #content-text, #content-text.yt-core-attributed-string');
    
    // Check all visible buttons
    const allButtons = document.querySelectorAll('button, ytcp-button');
    const loadMoreButtons = Array.from(allButtons).filter(btn => {
      const label = btn.getAttribute('aria-label') || btn.textContent || '';
      return label.toLowerCase().includes('load more') || 
             label.toLowerCase().includes('加载更多') || 
             label.toLowerCase().includes('更多');
    });
    
    const showMoreButtons = Array.from(allButtons).filter(btn => {
      const label = btn.getAttribute('aria-label') || btn.textContent || '';
      return label.toLowerCase().includes('show more') || 
             label.toLowerCase().includes('显示更多') || 
             label.toLowerCase().includes('更多回复');
    });
    
    // All buttons found: allButtons.length


    
    // Check if there are any elements with 'loading' text
    const loadingElements = document.querySelectorAll('*');
    const loadingTexts = Array.from(loadingElements).filter(el => {
      const text = el.textContent || '';
      return text.toLowerCase().includes('loading') || 
             text.toLowerCase().includes('加载') || 
             text.toLowerCase().includes('加载中');
    });
    
    if (loadingTexts.length > 0) {
      // Loading elements found
    }
  }
}

// Initialize the comment monitor
const commentMonitor = new YouTubeCommentMonitor();

// Export for debugging
window.youtubeAIReply = commentMonitor;

// Add helper function to reset reply count
window.resetReplyCount = function() {
  chrome.storage.local.remove(['replyCount'], () => {
    // Reply count has been reset
  });
};

// 添加消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    // 响应 ping 请求
    sendResponse({ success: true, message: 'pong' });
    return;
  }
  
  if (request.action === 'checkLogExists') {
    // 检查日志窗口是否存在
    sendResponse({ 
      success: true, 
      exists: !!window.youtubeReplyLog 
    });
    return;
  }
  
  if (request.action === 'autoReplyToggled') {

    // 更新设置
    commentMonitor.settings.autoReplyEnabled = request.enabled;
    
    // 记录日志
    if (request.enabled) {
      window.youtubeReplyLog?.info('自动回复已开启');
      // 如果之前有未处理的评论，可以在这里处理
    } else {
      window.youtubeReplyLog?.info('自动回复已关闭');
    }
    
    sendResponse({ success: true });
  }
  
  if (request.action === 'toggleLog') {
    // 处理日志窗口切换请求
    if (window.youtubeReplyLog) {
      window.youtubeReplyLog.toggle();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Log window not available' });
    }
  }
});

