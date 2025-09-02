// Content script for YouTube comment detection and reply
class YouTubeCommentMonitor {
  constructor() {
    this.observer = null;
    this.processedComments = new Set();
    this.recentlyProcessed = new Set(); // For preventing rapid duplicate processing
    this.replyQueue = [];
    this.isProcessing = false;
    this.isProcessingQueue = false; // 新增：队列处理状态
    this.isProcessingComments = false; // 防止重复处理评论
    this.settings = null;
    this.lastProcessedTexts = new Map(); // Track recently processed texts by position
    this.isScrolling = false;
    this.lastScrollTime = 0;
    this.scrollCheckInterval = null;
    this.sessionReplyCount = 0; // 会话回复计数器
    this.lastActivityTime = Date.now(); // 最后活动时间
    this.inactivityTimer = null; // 不活动定时器
    
    this.init();
  }

  clearCacheOnPageReload() {
    // 使用 sessionStorage 来检测页面刷新
    const reloadKey = 'youtube-reply-reload-time';
    const lastReload = sessionStorage.getItem(reloadKey);
    const now = Date.now();
    
    if (!lastReload || now - parseInt(lastReload) > 1000) {
      // 新加载或距离上次刷新超过1秒，清空缓存
      this.processedComments.clear();
      this.recentlyProcessed.clear();
      this.lastProcessedTexts.clear();
      if (window.youtubeReplyLog) {
        window.youtubeReplyLog.info('页面已刷新，清空评论缓存');
      }
    }
    
    sessionStorage.setItem(reloadKey, now.toString());
  }

  async init() {
    // console.log('YouTube AI Reply content script loaded');
    
    // 页面刷新时清空缓存
    this.clearCacheOnPageReload();
    
    // 重置会话回复计数器
    this.sessionReplyCount = 0;
    
    // 初始化日志
    if (window.youtubeReplyLog) {
      window.youtubeReplyLog.info('=== 初始化 YouTube AI Reply ===');
      window.youtubeReplyLog.info('版本:', '1.0');
      window.youtubeReplyLog.info('页面URL:', window.location.href);
      window.youtubeReplyLog.info('会话回复计数器已重置');
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
    
    // Setup activity monitoring will be called after init
    setTimeout(() => {
      this.setupActivityMonitoring();
    }, 1000);
  }

  async loadSettings() {
    try {
      window.youtubeReplyLog?.debug('正在加载设置...');
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response && response.success) {
        // 复制设置，保持autoReplyEnabled的原始值
        this.settings = { ...response.settings };
        window.youtubeReplyLog?.info('设置已加载:', JSON.stringify({
          autoReplyEnabled: this.settings.autoReplyEnabled,
          hasApiKey: !!this.settings.apiKey,
          replyDelay: this.settings.replyDelay,
          maxRepliesPerSession: this.settings.maxRepliesPerSession
        }));
        
        // 初始化日志显示的最大回复数
        if (window.youtubeReplyLog) {
          const maxReplies = this.settings.maxRepliesPerSession || 10;
          window.youtubeReplyLog.updateReplyCount(this.sessionReplyCount, maxReplies);
        }
        
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
        
        // 初始化日志显示的最大回复数
        if (window.youtubeReplyLog) {
          window.youtubeReplyLog.updateReplyCount(this.sessionReplyCount, 10);
        }
        
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
      
      // 初始化日志显示的最大回复数
      if (window.youtubeReplyLog) {
        window.youtubeReplyLog.updateReplyCount(this.sessionReplyCount, 10);
      }
      
      return false;
    }
  }

  listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        const oldSettings = changes.settings.oldValue;
        const newSettings = changes.settings.newValue;
        this.settings = newSettings;
        
        // 如果自动回复被关闭，立即停止所有动作
        if (oldSettings && oldSettings.autoReplyEnabled && !newSettings.autoReplyEnabled) {
          window.youtubeReplyLog?.status('⛔ 自动回复已手动关闭，停止所有动作');
          this.stopAutoReply();
          this.stopAutoScroll();
          this.replyQueue = [];
          this.isProcessingQueue = false;
          this.isProcessingComments = false;
          this.sessionReplyCount = 0;
          return;
        }
        
        // 如果最大回复数设置有变化，更新显示
        if (!oldSettings || oldSettings.maxRepliesPerSession !== newSettings.maxRepliesPerSession) {
          const currentCount = this.sessionReplyCount;
          const maxReplies = newSettings.maxRepliesPerSession || 10;
          if (window.youtubeReplyLog) {
            window.youtubeReplyLog.updateReplyCount(currentCount, maxReplies);
          }
        }
        
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

    // 添加防抖机制，避免短时间内重复处理
    let debounceTimer;
    this.observer = new MutationObserver((mutations) => {
      // 清除之前的定时器
      clearTimeout(debounceTimer);
      
      // 设置新的定时器，延迟100ms处理
      debounceTimer = setTimeout(() => {
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
              if (text.trim().length > 0 && 
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
                if (text.trim().length > 0 && 
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
      }, 100); // 100ms防抖延迟
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
    
    // 定期检查是否有遗漏的评论（添加防抖机制）
    this.commentCheckInterval = setInterval(() => {
      if (!this.isProcessingQueue && !this.isProcessingComments && 
          this.settings?.autoReplyEnabled &&
          (!this.settings?.maxRepliesPerSession || 
           this.sessionReplyCount < this.settings.maxRepliesPerSession)) {
        // 添加防抖，避免短时间内重复调用
        if (!this.lastCheckTime || Date.now() - this.lastCheckTime > 5000) {
          this.lastCheckTime = Date.now();
          this.processExistingComments();
        }
      }
    }, 30000); // 每30秒检查一次
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
      // 防止重复处理
      if (this.isProcessingComments) {
        const stack = new Error().stack;
        window.youtubeReplyLog?.debug('正在处理评论中，跳过重复调用');
        window.youtubeReplyLog?.debug(`调用栈: ${stack.split('\n').slice(3, 6).join('\n')}`);
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        window.youtubeReplyLog?.debug('已达到回复限制，跳过评论扫描');
        return;
      }
      
      this.isProcessingComments = true;
      window.youtubeReplyLog?.debug('开始处理现有评论...');
      
      // 查找所有评论元素，使用更精确的选择器
      const existingComments = document.querySelectorAll(
        'ytcp-comment-thread ytcp-comment #content-text, ' +
        'ytcp-comment #content-text, ' +
        '#content-text.yt-core-attributed-string'
      );
      
      let processedCount = 0;
      let newCount = 0;
      
      // 如果队列为空，找出所有未处理的评论
      if (this.replyQueue.length === 0) {
        // 按位置排序，确保从上到下处理
        const commentsArray = Array.from(existingComments).map(comment => ({
          element: comment,
          text: this.extractCommentText(comment),
          id: this.getCommentId(comment),
          position: this.getElementPosition(comment)
        })).filter(comment => 
          !this.processedComments.has(comment.id) && 
          comment.text && 
          comment.text.trim().length > 0
        ).sort((a, b) => a.position - b.position);
        
        // 批量添加到队列
        window.youtubeReplyLog?.debug('准备添加到队列的评论列表:');
        commentsArray.forEach((comment, index) => {
          window.youtubeReplyLog?.debug(`  ${index + 1}. 位置: ${comment.position}px, 内容: ${comment.text.substring(0, 30)}...`);
        });
        
        commentsArray.forEach(comment => {
          this.processedComments.add(comment.id);
          this.replyQueue.push({
            commentId: comment.id,
            commentText: comment.text,
            element: comment.element,
            timestamp: Date.now(),
            position: comment.position
          });
          newCount++;
        });
        
        if (newCount > 0) {
          window.youtubeReplyLog?.info(`发现 ${newCount} 条新评论需要处理，已加入队列`);
          
          // 如果队列没有在处理中，则开始处理
          if (!this.isProcessingQueue) {
            this.processReplyQueue();
          }
        }
      } else {
        window.youtubeReplyLog?.debug(`队列中已有 ${this.replyQueue.length} 条评论在等待处理`);
      }
      
      // 重置处理状态
      setTimeout(() => {
        this.isProcessingComments = false;
        window.youtubeReplyLog?.debug('isProcessingComments 状态已重置');
      }, 1000);
      
    } catch (error) {
      console.error('Error processing existing comments:', error);
      this.isProcessingComments = false;
    }
  }

  async processNewComment(commentElement) {
    try {
      // 更新活动时间
      this.updateActivity();
      
      // 防止重复处理 - 检查是否正在处理中
      if (this.isProcessingQueue) {
        window.youtubeReplyLog?.debug('队列正在处理中，跳过新评论');
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        window.youtubeReplyLog?.debug('已达到回复限制，不处理新评论');
        return;
      }
      
      // Ensure settings are loaded
      if (!this.settings) {
        window.youtubeReplyLog?.debug('设置未加载，正在加载...');
        await this.loadSettings();
        if (!this.settings) {
          window.youtubeReplyLog?.error('设置加载失败');
          return;
        }
      }
      
      const commentText = this.extractCommentText(commentElement);
      if (!commentText) {
        return; // 静默跳过空评论
      }
      
      // 只在调试模式下显示发现评论的日志
      if (window.youtubeReplyLog?.isDebugMode) {
        window.youtubeReplyLog?.processing(`发现评论: ${commentText?.substring(0, 30)}...`);
      }
      
      if (!this.settings?.autoReplyEnabled) {
        window.youtubeReplyLog?.debug('自动回复已禁用');
        return;
      }
      
      if (!this.settings?.apiKey) {
        window.youtubeReplyLog?.warning('未配置API密钥');
        return;
      }

      // 所有的评论都应该处理，不跳过任何评论
      // Get the position of the comment
      const position = this.getElementPosition(commentElement);
      
      // Get comment ID to avoid duplicates
      const commentId = this.getCommentId(commentElement);
      
      // Skip if this is a reply
      if (commentId === 'reply_skip') {
        return;
      }
      
      // 检查是否已经处理过
      if (this.processedComments.has(commentId)) {
        window.youtubeReplyLog?.debug(`评论已处理过，跳过: ${commentId}`);
        return;
      }
      
      // 立即标记为已处理，防止重复加入队列
      this.processedComments.add(commentId);
      
      // Add to reply queue
      this.replyQueue.push({
        commentId,
        commentText,
        element: commentElement,
        timestamp: Date.now(),
        position
      });
      
      window.youtubeReplyLog?.info(`评论已加入队列 (队列长度: ${this.replyQueue.length})，位置: ${position}px`);
      
      // 如果队列没有在处理中，则开始处理
      if (!this.isProcessingQueue && this.replyQueue.length > 0) {
        window.youtubeReplyLog?.debug('开始处理回复队列');
        this.processReplyQueue();
      }
    } catch (error) {
      console.error('Error processing new comment:', error);
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
      
      // If no stable ID found, use hash of comment text and timestamp
      const textHash = this.simpleHash(commentText);
      // Check if we've seen similar content recently
      const now = Date.now();
      const timeWindow = Math.floor(now / 300000); // 5-minute windows
      
      // Also check for author info to make ID more unique
      const authorElement = commentElement.querySelector('.author-name, .comment-author, [id="author-text"]') ||
                           commentElement.closest('.comment-renderer')?.querySelector('.author-name');
      const authorName = authorElement ? authorElement.textContent.trim().substring(0, 10) : 'unknown';
      const authorHash = this.simpleHash(authorName);
      
      // Create ID that's stable within a time window, including author info
      const uniqueId = `comment_${textHash}_${authorHash}_${timeWindow}`;
      window.youtubeReplyLog?.debug(`生成评论ID: ${uniqueId} (基于文本、作者和时间窗口)`);
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
    // Get the Y position of the element relative to the viewport
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    
    // Return position relative to document top
    return Math.round(rect.top + scrollY);
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

  // 检查是否应该使用预置回复
  shouldUsePresetReply(commentText) {
    if (!this.settings?.localReplyRules || !this.settings?.presetReplies || this.settings.presetReplies.length === 0) {
      return false;
    }

    const text = commentText.trim();
    
    // 检查是否符合本地回复规则
    return this.settings.localReplyRules.some(rule => {
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
  getRandomPresetReply() {
    const replies = this.settings?.presetReplies;
    if (!replies || replies.length === 0) {
      return '感谢你的评论！💖'; // 默认回复
    }
    return replies[Math.floor(Math.random() * replies.length)];
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
      window.youtubeReplyLog?.debug(`跳过评论: 长度小于4个字符 - "${text}"`);
      return true;
    }
    
    // Check against skip patterns
    for (const pattern of skipPatterns) {
      if (pattern.test(trimmedText)) {
        window.youtubeReplyLog?.debug(`跳过评论: 匹配跳过规则 - "${text}"`);
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
        window.youtubeReplyLog?.debug('未找到评论容器，跳过点赞');
        return;
      }

      // Click the like button
      const likeButton = commentContainer.querySelector('#like-button ytcp-icon-button') ||
                        commentContainer.querySelector('#like-button button') ||
                        commentContainer.querySelector('ytcp-comment-toggle-button#like-button ytcp-icon-button');
      
      if (likeButton) {
        likeButton.click();
        window.youtubeReplyLog?.info('已为评论点赞');
      } else {
        window.youtubeReplyLog?.debug('未找到点赞按钮');
      }

    } catch (error) {
      console.error('Error clicking like button:', error);
    }
  }

  async clickHeartButton(commentElement) {
    try {
      // Find the heart button within the comment
      const commentContainer = commentElement.closest('ytcp-comment');
      if (!commentContainer) {
        window.youtubeReplyLog?.debug('未找到评论容器，跳过点红心');
        return;
      }

      // Click the creator heart button
      const heartButton = commentContainer.querySelector('#creator-heart-button ytcp-icon-button') ||
                         commentContainer.querySelector('#creator-heart-button button') ||
                         commentContainer.querySelector('#creator-heart #creator-heart-button');
      
      if (heartButton) {
        heartButton.click();
        window.youtubeReplyLog?.info('已为评论点红心');
      } else {
        window.youtubeReplyLog?.debug('未找到红心按钮');
      }

    } catch (error) {
      console.error('Error clicking heart button:', error);
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
    window.youtubeReplyLog?.debug(`processReplyQueue 被调用，队列长度: ${this.replyQueue.length}，处理状态: ${this.isProcessingQueue}`);
    
    if (this.isProcessingQueue || this.replyQueue.length === 0) {
      window.youtubeReplyLog?.debug(`队列处理被跳过 - 正在处理: ${this.isProcessingQueue}，队列空: ${this.replyQueue.length === 0}`);
      return;
    }

    this.isProcessingQueue = true;
    
    // 停止自动滚动，避免干扰回复过程
    this.stopAutoScroll();

    try {
      // 按位置排序，确保从上到下处理
      this.replyQueue.sort((a, b) => a.position - b.position);
      
      const totalInQueue = this.replyQueue.length;
      window.youtubeReplyLog?.info(`开始处理队列，共 ${totalInQueue} 条评论`);
      
      // 显示队列中的所有评论
      window.youtubeReplyLog?.debug('队列中的评论列表:');
      this.replyQueue.forEach((comment, index) => {
        window.youtubeReplyLog?.debug(`  ${index + 1}. 位置: ${comment.position}px, 内容: ${comment.commentText.substring(0, 30)}...`);
      });
      
      let processedCount = 0;
      while (this.replyQueue.length > 0) {
        const comment = this.replyQueue.shift();
        processedCount++;
        
        window.youtubeReplyLog?.info(`处理第 ${processedCount}/${totalInQueue} 条评论`);
        window.youtubeReplyLog?.debug(`当前处理: 位置 ${comment.position}px, 内容: ${comment.commentText.substring(0, 30)}...`);
        
        // 再次检查是否应该回复
        if (await this.shouldReplyToComment(comment)) {
          try {
            await this.generateAndPostReply(comment);
            
            // 处理完成后，向下滚动以查看下一条评论
            if (this.replyQueue.length > 0) {
              await this.scrollDownAfterReply();
            }
            
          } catch (error) {
            console.error('Error processing comment:', error);
            window.youtubeReplyLog?.error(`处理评论时出错: ${error.message}`);
          }
        } else {
          window.youtubeReplyLog?.debug(`跳过评论: ${comment.commentText.substring(0, 30)}`);
        }
        
        // 添加延迟，避免操作过快
        await this.sleep(this.settings?.replyDelay || 3000);
        
        // 检查是否达到回复限制
        if (this.settings?.maxRepliesPerSession && 
            this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
          window.youtubeReplyLog?.status(`已达到回复限制 (${this.settings.maxRepliesPerSession} 条)，停止处理`);
          break;
        }
      }
      
      window.youtubeReplyLog?.success(`队列处理完成，共处理 ${processedCount} 条评论`);
      
    } finally {
      this.isProcessingQueue = false;
      
      // 队列处理完成后，检查是否还有未加载的评论
      if (this.settings?.autoReplyEnabled && 
          this.sessionReplyCount < (this.settings?.maxRepliesPerSession || 10)) {
        // 延迟后重新开始自动滚动以加载更多评论
        setTimeout(() => {
          if (!this.isProcessingQueue && !this.isScrolling) {
            this.startAutoScroll();
          }
        }, 3000);
      }
    }
  }

  async shouldReplyToComment(comment) {
    window.youtubeReplyLog?.debug('检查是否应该回复评论...');
    
    // Check if auto-reply is enabled
    if (!this.settings?.autoReplyEnabled) {
      window.youtubeReplyLog?.debug('自动回复已禁用，跳过回复');
      this.stopAutoScroll();
      return false;
    }

    // Check reply limit
    if (this.settings?.maxRepliesPerSession) {
      if (this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        window.youtubeReplyLog?.status('⛔ 已达到单次最大回复数，停止自动回复');
        this.stopAutoScroll();
        return false;
      }
    }

    // 所有评论都应该回复，使用本地回复规则判断是否使用预置回复
    window.youtubeReplyLog?.debug(`评论准备回复: ${comment.commentText.substring(0, 30)}...`);
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
    // 不再限制每日回复数量，只用于统计
    return new Promise((resolve) => {
      const today = new Date().toDateString();
      chrome.storage.local.get(['replyCount', 'totalReplyCount'], (result) => {
        const countData = result.replyCount || {};
        countData[today] = (countData[today] || 0) + 1;
        
        // 更新累计回复数
        const totalReplyCount = (result.totalReplyCount || 0) + 1;
        
        chrome.storage.local.set({ 
          replyCount: countData,
          totalReplyCount: totalReplyCount
        }, () => {
          resolve();
        });
      });
    });
  }

  async generateAndPostReply(comment) {
    try {
      // 更新活动时间
      this.updateActivity();
      
      // 获取当前回复编号（使用会话计数器）
      const replyNumber = this.sessionReplyCount + 1;
      
      // 更新回复编号显示
      if (window.youtubeReplyLog) {
        window.youtubeReplyLog.setCurrentReplyNumber(replyNumber);
        window.youtubeReplyLog.step(`📝 正在回复第 ${replyNumber} 条评论`);
      }
      
      window.youtubeReplyLog?.processing('💭 正在生成回复内容...');
      window.youtubeReplyLog?.debug(`📄 原评论: ${comment.commentText.substring(0, 50)}...`);

      let replyText;
      let aiResponse = null;
      let usePresetReply = false;
      
      // 首先检查是否应该使用预置回复（基于本地回复规则）
      if (this.settings?.localReplyRules && this.settings?.presetReplies) {
        usePresetReply = this.shouldUsePresetReply(comment.commentText);
        if (usePresetReply) {
          replyText = this.getRandomPresetReply();
          window.youtubeReplyLog?.info('📋 使用预置回复:', replyText);
        }
      }
      
      // 如果不使用预置回复，检查是否是表情符号评论
      if (!replyText && this.isEmojiHeavy(comment.commentText)) {
        replyText = this.generateEmojiReply();
        window.youtubeReplyLog?.info('😊 使用表情回复:', replyText);
        // emoji回复不执行点赞操作
      } else if (!replyText) {
        // Generate AI reply for regular comments
        window.youtubeReplyLog?.debug('🤖 请求AI生成回复...');
        let response;
        try {
          response = await chrome.runtime.sendMessage({
            action: 'generateReply',
            commentText: comment.commentText,
            replyStyle: this.settings?.replyStyle || 'friendly'
          });
          
          // 检查响应是否存在
          if (!response) {
            throw new Error('未收到API响应');
          }
          
          if (!response.success) {
            throw new Error(response.error || 'API请求失败');
          }
        } catch (error) {
          // 如果是消息传递错误，添加更详细的错误信息
          if (error.message.includes('message channel closed')) {
            throw new Error('API响应超时，请重试');
          }
          throw error;
        }

        // 保存AI响应信息用于后续操作
        aiResponse = response.reply;
        
        // 处理新的响应格式
        if (typeof aiResponse === 'object' && aiResponse !== null) {
          // 新格式：包含reply、quality和actions
          replyText = aiResponse.reply;
          const actions = aiResponse.actions || [];
          
          window.youtubeReplyLog?.success('✅ AI回复已生成');
          window.youtubeReplyLog?.info(`💬 回复内容: ${replyText}`);
          if (aiResponse.quality) {
            window.youtubeReplyLog?.info(`⭐ 评论质量: ${aiResponse.quality}`);
          }
          if (actions.length > 0) {
            window.youtubeReplyLog?.info(`🎯 执行操作: ${actions.join(', ')}`);
          }
        } else {
          // 旧格式：直接返回回复文本
          replyText = aiResponse;
          window.youtubeReplyLog?.success('✅ AI回复已生成');
          window.youtubeReplyLog?.info(`💬 回复内容: ${replyText}`);
        }
      }

      // Post the reply
      window.youtubeReplyLog?.step('📤 正在发布回复...');
      await this.postReply(comment.element, replyText);

      // 根据AI判断执行点赞和点红心操作
      if (typeof aiResponse === 'object' && aiResponse !== null && aiResponse.actions) {
        const actions = aiResponse.actions;
        if (actions.includes('like')) {
          window.youtubeReplyLog?.processing('👍 正在点赞...');
          await this.clickLikeButton(comment.element);
        }
        if (actions.includes('heart')) {
          window.youtubeReplyLog?.processing('❤️ 正在点红心...');
          await this.clickHeartButton(comment.element);
        }
      }

      // Increment reply count and update display
      await this.incrementReplyCount();
      this.sessionReplyCount++; // 增加会话回复计数
      
      // 更新贴边按钮显示为会话计数器
      if (window.youtubeReplyLog) {
        const maxReplies = this.settings?.maxRepliesPerSession || 10;
        window.youtubeReplyLog.updateReplyCount(this.sessionReplyCount, maxReplies);
      }
      
      window.youtubeReplyLog?.success(`🎉 第 ${replyNumber} 条回复完成！`);

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
    // 检查是否已经在滚动中
    if (this.isScrolling) {
      window.youtubeReplyLog?.debug('自动滚动已在运行中，跳过启动');
      return;
    }
    
    // 只有在自动回复启用且未达到限制时才启动自动滚动
    if (!this.settings?.autoReplyEnabled) {
      return;
    }
    
    if (this.settings?.maxRepliesPerSession && 
        this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
      return;
    }
    
    this.isScrolling = true;
    this.lastScrollTime = 0;
    
    // 使用更长的间隔，减少干扰
    this.scrollCheckInterval = setInterval(() => {
      this.checkAndScroll();
    }, 5000); // 每5秒检查一次
    
    // 延迟后首次检查
    setTimeout(() => {
      this.checkAndScroll();
    }, 2000);
  }

  checkAndScroll() {
    try {
      // 不要在处理评论时滚动
      if (this.isProcessingQueue || this.isProcessingComments) {
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        this.stopAutoScroll();
        window.youtubeReplyLog?.status('⏹️ 已达到回复限制，停止自动滚动');
        return;
      }
      
      const now = Date.now();
      // 至少间隔15秒才滚动一次
      if (now - this.lastScrollTime < 15000) {
        return;
      }
      
      // 首先查找"加载更多"按钮
      const loadMoreButton = document.querySelector(
        'ytcp-button[aria-label*="Load more"], ' +
        'ytcp-button[aria-label*="加载更多"], ' +
        'ytcp-button[aria-label*="更多"], ' +
        'button[aria-label*="Load more"], ' +
        'button[aria-label*="加载更多"]'
      );
      
      if (loadMoreButton && loadMoreButton.offsetParent !== null) {
        window.youtubeReplyLog?.debug('点击加载更多按钮');
        loadMoreButton.click();
        this.lastScrollTime = now;
        return;
      }
      
      // 检查是否需要滚动以加载更多评论
      const scrollContainer = this.findScrollContainer();
      if (!scrollContainer) {
        return;
      }
      
      const scrollTop = scrollContainer.scrollTop || window.scrollY;
      const scrollHeight = scrollContainer.scrollHeight || document.documentElement.scrollHeight;
      const clientHeight = scrollContainer.clientHeight || window.innerHeight;
      
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      
      // 如果距离底部超过1000px，则向下滚动
      if (distanceFromBottom > 1000) {
        const scrollAmount = Math.min(600, distanceFromBottom / 2);
        
        if (scrollContainer === window) {
          window.scrollTo({
            top: scrollTop + scrollAmount,
            behavior: 'smooth'
          });
        } else {
          scrollContainer.scrollTo({
            top: scrollTop + scrollAmount,
            behavior: 'smooth'
          });
        }
        
        this.lastScrollTime = now;
        window.youtubeReplyLog?.debug(`自动向下滚动 ${scrollAmount}px，距离底部 ${distanceFromBottom}px`);
        
        // 滚动后检查新评论（仅在不在处理队列时）
        setTimeout(() => {
          if (!this.isProcessingQueue) {
            this.processExistingComments();
          }
        }, 2000);
      } else {
        window.youtubeReplyLog?.debug(`已接近底部，距离底部 ${distanceFromBottom}px`);
      }
      
    } catch (error) {
      console.error('Error in auto-scroll:', error);
    }
  }
  
  findScrollContainer() {
    // 查找主要的滚动容器
    const containers = [
      document.querySelector('ytcp-activity-section'),
      document.querySelector('#primary-inner'),
      document.querySelector('#primary'),
      document.querySelector('#comments'),
      document.querySelector('.ytcp-app')
    ].filter(Boolean);
    
    for (const container of containers) {
      if (container && container.scrollHeight > container.clientHeight) {
        return container;
      }
    }
    
    return window;
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
    // 监听滚动事件以检测新评论
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
      
      target.addEventListener('scroll', (event) => {
        // 防抖处理
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
          this.checkForNewCommentsAfterScroll();
        }, 500);
      }, { capture: true, passive: true });
    });
  }
  
  checkForNewCommentsAfterScroll() {
    // 简化版本，只在需要时处理
    if (!this.isProcessingQueue) {
      this.processExistingComments();
    }
  }
  
  async checkAndScrollIfNeeded() {
    try {
      // 这个方法现在由 scrollDownAfterReply 替代
      return;
    } catch (error) {
      console.error('Error in checkAndScrollIfNeeded:', error);
    }
  }
  
  async loadMoreComments() {
    try {
      window.youtubeReplyLog?.info('检查是否可以加载更多评论...');
      
      // 查找"加载更多"按钮
      const loadMoreButtons = document.querySelectorAll(
        'ytcp-button[aria-label*="Load more"], ' +
        'ytcp-button[aria-label*="加载更多"], ' +
        'ytcp-button[aria-label*="更多"], ' +
        'button[aria-label*="Load more"], ' +
        'button[aria-label*="加载更多"]'
      );
      
      if (loadMoreButtons.length > 0) {
        window.youtubeReplyLog?.info(`找到 ${loadMoreButtons.length} 个加载更多按钮`);
        
        for (const button of loadMoreButtons) {
          if (button.offsetParent !== null) { // 确保按钮可见
            window.youtubeReplyLog?.debug('点击加载更多按钮');
            button.click();
            await this.sleep(3000); // 等待新评论加载
            
            // 检查新加载的评论
            await this.processExistingComments();
            break;
          }
        }
      } else {
        // 如果没有加载更多按钮，尝试滚动到底部
        const scrollContainer = this.findScrollContainer();
        if (scrollContainer) {
          const scrollHeight = scrollContainer.scrollHeight || document.documentElement.scrollHeight;
          const clientHeight = scrollContainer.clientHeight || window.innerHeight;
          const scrollTop = scrollContainer.scrollTop || window.scrollY;
          
          // 如果距离底部还有空间，向下滚动
          if (scrollTop + clientHeight < scrollHeight - 100) {
            window.youtubeReplyLog?.debug('向下滚动以加载更多评论...');
            
            if (scrollContainer === window) {
              window.scrollTo({
                top: scrollTop + 800,
                behavior: 'smooth'
              });
            } else {
              scrollContainer.scrollTo({
                top: scrollTop + 800,
                behavior: 'smooth'
              });
            }
            
            await this.sleep(3000);
            
            // 再次检查评论
            await this.processExistingComments();
          } else {
            window.youtubeReplyLog?.info('已到达页面底部，没有更多评论可加载');
          }
        }
      }
    } catch (error) {
      console.error('Error in loadMoreComments:', error);
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
    const oldEnabled = commentMonitor.settings.autoReplyEnabled;
    commentMonitor.settings.autoReplyEnabled = request.enabled;
    
    // 只在状态变化时记录日志
    if (oldEnabled !== request.enabled) {
      if (request.enabled) {
        window.youtubeReplyLog?.status('🚀 自动回复已开启');
        // 如果之前有未处理的评论，可以在这里处理
      } else {
        window.youtubeReplyLog?.status('⏸️ 自动回复已关闭');
      }
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

// 在类的最后添加新方法
YouTubeCommentMonitor.prototype.setupActivityMonitoring = function() {
  // 监控活动状态，如果长时间没有活动则停止自动回复
  const checkInactivity = () => {
    const now = Date.now();
    const inactiveTime = now - this.lastActivityTime;
    
    // 如果5分钟没有活动，停止自动回复
    if (inactiveTime > 300000 && this.settings?.autoReplyEnabled) {
      window.youtubeReplyLog?.warning('⚠️ 长时间无活动，自动停止回复');
      this.stopAutoReply();
    }
  };
  
  // 每分钟检查一次
  setInterval(checkInactivity, 60000);
};

YouTubeCommentMonitor.prototype.updateActivity = function() {
  this.lastActivityTime = Date.now();
};

YouTubeCommentMonitor.prototype.stopAutoReply = function() {
  // 停止所有自动回复活动
  this.stopAutoScroll();
  this.isProcessingQueue = false;
  this.replyQueue = [];
  
  // 更新设置
  if (this.settings) {
    this.settings.autoReplyEnabled = false;
    chrome.storage.sync.set({ settings: this.settings }, () => {
      window.youtubeReplyLog?.status('⏸️ 自动回复已停止');
    });
  }
};


YouTubeCommentMonitor.prototype.scrollDownAfterReply = async function() {
  try {
    // 等待一下确保回复已经完全提交
    await this.sleep(1000);
    
    // 获取当前滚动位置
    const currentScroll = window.scrollY || document.documentElement.scrollTop;
    const targetScroll = currentScroll + 230;
    
    window.youtubeReplyLog?.debug(`向下滚动 230px (从 ${currentScroll} 到 ${targetScroll})`);
    
    // 查找YouTube Studio的滚动容器
    const containers = [
      document.querySelector('ytcp-activity-section'),
      document.querySelector('#primary-inner'),
      document.querySelector('#primary'),
      document.querySelector('.ytcp-app')
    ].filter(Boolean);
    
    let scrollContainer = null;
    for (const container of containers) {
      if (container && container.scrollHeight > container.clientHeight) {
        scrollContainer = container;
        window.youtubeReplyLog?.debug(`找到滚动容器: ${container.tagName.toLowerCase()}`);
        break;
      }
    }
    
    // 如果没有找到容器，使用window
    if (!scrollContainer) {
      scrollContainer = window;
      window.youtubeReplyLog?.debug('使用window作为滚动容器');
    }
    
    // 尝试多种滚动方法
    let scrollSuccess = false;
    
    // 方法1：直接设置scrollTop
    try {
      if (scrollContainer === window) {
        window.scrollTo(0, targetScroll);
      } else {
        scrollContainer.scrollTop = targetScroll;
      }
      
      // 等待一下
      await this.sleep(100);
      
      // 验证
      const actualScroll = scrollContainer === window ? 
        (window.scrollY || document.documentElement.scrollTop) : 
        scrollContainer.scrollTop;
      
      if (Math.abs(actualScroll - targetScroll) < 50) {
        scrollSuccess = true;
        window.youtubeReplyLog?.debug('方法1成功: 直接设置scrollTop');
      }
    } catch (e) {
      window.youtubeReplyLog?.debug(`方法1失败: ${e.message}`);
    }
    
    // 方法2：使用scrollTo
    if (!scrollSuccess) {
      try {
        if (scrollContainer === window) {
          window.scrollTo({ top: targetScroll, behavior: 'auto' });
        } else {
          scrollContainer.scrollTo({ top: targetScroll, behavior: 'auto' });
        }
        
        await this.sleep(100);
        
        const actualScroll = scrollContainer === window ? 
          (window.scrollY || document.documentElement.scrollTop) : 
          scrollContainer.scrollTop;
        
        if (Math.abs(actualScroll - targetScroll) < 50) {
          scrollSuccess = true;
          window.youtubeReplyLog?.debug('方法2成功: scrollTo');
        }
      } catch (e) {
        window.youtubeReplyLog?.debug(`方法2失败: ${e.message}`);
      }
    }
    
    // 方法3：模拟键盘PageDown键
    if (!scrollSuccess) {
      try {
        // 创建PageDown按键事件
        const pageDownEvent = new KeyboardEvent('keydown', {
          key: 'PageDown',
          code: 'PageDown',
          keyCode: 34,
          which: 34,
          bubbles: true,
          cancelable: true
        });
        
        document.dispatchEvent(pageDownEvent);
        await this.sleep(200);
        
        const actualScroll = scrollContainer === window ? 
          (window.scrollY || document.documentElement.scrollTop) : 
          scrollContainer.scrollTop;
        
        if (actualScroll > currentScroll + 100) {
          scrollSuccess = true;
          window.youtubeReplyLog?.debug('方法3成功: 模拟PageDown键');
        }
      } catch (e) {
        window.youtubeReplyLog?.debug(`方法3失败: ${e.message}`);
      }
    }
    
    // 方法4：模拟空格键（某些页面会响应空格键滚动）
    if (!scrollSuccess) {
      try {
        const spaceEvent = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          keyCode: 32,
          which: 32,
          bubbles: true,
          cancelable: true
        });
        
        document.dispatchEvent(spaceEvent);
        await this.sleep(200);
        
        const actualScroll = scrollContainer === window ? 
          (window.scrollY || document.documentElement.scrollTop) : 
          scrollContainer.scrollTop;
        
        if (actualScroll > currentScroll + 100) {
          scrollSuccess = true;
          window.youtubeReplyLog?.debug('方法4成功: 模拟空格键');
        }
      } catch (e) {
        window.youtubeReplyLog?.debug(`方法4失败: ${e.message}`);
      }
    }
    
    // 方法5：使用CSS transform临时移动内容
    if (!scrollSuccess) {
      try {
        window.youtubeReplyLog?.debug('尝试使用CSS transform方法...');
        
        // 查找主内容区域
        const mainContent = document.querySelector('ytcp-activity-section') || 
                           document.querySelector('#primary-inner') ||
                           document.querySelector('#primary');
        
        if (mainContent) {
          // 记录原始transform
          const originalTransform = mainContent.style.transform || '';
          
          // 应用向上移动的transform
          mainContent.style.transform = `translateY(-230px)`;
          mainContent.style.transition = 'transform 0.3s ease';
          
          await this.sleep(300);
          
          // 恢复原始transform，同时设置实际的scrollTop
          mainContent.style.transition = '';
          mainContent.style.transform = originalTransform;
          
          if (scrollContainer === window) {
            window.scrollTo(0, currentScroll + 230);
          } else {
            scrollContainer.scrollTop = currentScroll + 230;
          }
          
          await this.sleep(100);
          
          const actualScroll = scrollContainer === window ? 
            (window.scrollY || document.documentElement.scrollTop) : 
            scrollContainer.scrollTop;
          
          if (actualScroll > currentScroll + 200) {
            scrollSuccess = true;
            window.youtubeReplyLog?.debug('方法5成功: CSS transform');
          }
        }
      } catch (e) {
        window.youtubeReplyLog?.debug(`方法5失败: ${e.message}`);
      }
    }
    
    // 验证最终结果
    const finalScroll = scrollContainer === window ? 
      (window.scrollY || document.documentElement.scrollTop) : 
      scrollContainer.scrollTop;
    const scrollDiff = finalScroll - currentScroll;
    
    window.youtubeReplyLog?.debug(`最终滚动距离: ${scrollDiff}px`);
    
    if (!scrollSuccess) {
      window.youtubeReplyLog?.warning('⚠️ 所有滚动方法都失败了，页面可能阻止了程序化滚动');
    }
    
  } catch (error) {
    console.error('Error scrolling down after reply:', error);
  }
};

// 添加清理方法
YouTubeCommentMonitor.prototype.cleanup = function() {
  // 清理所有定时器和观察者
  if (this.observer) {
    this.observer.disconnect();
    this.observer = null;
  }
  
  if (this.scrollCheckInterval) {
    clearInterval(this.scrollCheckInterval);
    this.scrollCheckInterval = null;
  }
  
  if (this.commentCheckInterval) {
    clearInterval(this.commentCheckInterval);
    this.commentCheckInterval = null;
  }
  
  this.stopAutoScroll();
  this.isProcessingQueue = false;
  this.isProcessingComments = false;
  this.replyQueue = [];
  
  window.youtubeReplyLog?.info('清理完成');
};

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  if (window.youtubeCommentMonitor) {
    window.youtubeCommentMonitor.cleanup();
  }
});

