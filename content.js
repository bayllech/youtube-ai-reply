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
    this.restartTimer = null; // 重启定时器
    this.myReplyCache = new Set(); // 缓存自己的回复内容，避免重复回复
    this.recentlyProcessedIds = new Set(); // 最近处理的评论ID，用于快速查找
    this.positionCommentMap = new Map(); // 位置到评论ID的映射，检测位置重复
    
    // 频道作者检测相关
    this.channelName = null; // 当前频道名称
    this.channelOwnerSelector = '.channel-owner, .ytcp-author-comment-badge[is-creator], [is-creator="true"]'; // 频道作者标识选择器
    
    // 滚动检查防抖
    this.lastScrollCheckTime = 0; // 上次滚动检查时间
    this.lastProcessingTime = 0; // 上次处理评论时间
    this.scrollTimeout = null; // 滚动防抖定时器
    
    // 添加日志输出控制标志
    this.hasLoggedLimitReached = false; // 是否已记录达到限制日志
    this.hasLoggedQueueLimitReached = false; // 是否已记录队列达到限制日志
    this.hasLoggedScrollLimitReached = false; // 是否已记录滚动达到限制日志
    
    this.init();
  }

  clearCacheOnPageReload() {
    // 页面加载时清空所有内存缓存，确保刷新页面后重新开始
    this.processedComments.clear();
    this.recentlyProcessed.clear();
    this.lastProcessedTexts.clear();
    this.myReplyCache.clear(); // 清空回复缓存
    this.recentlyProcessedIds.clear(); // 清空最近处理的ID
    this.positionCommentMap.clear(); // 清空位置映射
    
    if (window.youtubeReplyLog) {
      window.youtubeReplyLog.info('页面已刷新，清空所有评论缓存');
    }
  }

  // 持久化缓存管理方法已移除，只使用会话级别的缓存
  // loadPersistentCache() {
  //   // 此方法已移除
  // }
  // 
  // savePersistentCache() {
  //   // 此方法已移除
  // }

  isCommentProcessed(commentId) {
    // 只检查当前会话处理集合和内存缓存，不使用持久化存储
    if (this.recentlyProcessedIds.has(commentId)) {
      return true;
    }
    
    // 检查内存缓存
    if (this.processedComments.has(commentId)) {
      return true;
    }
    
    return false;
  }

  markCommentAsProcessed(commentId) {
    // 只添加到内存缓存，不使用持久化存储
    this.processedComments.add(commentId);
  }

  startCacheCleanup() {
    // 每10分钟清理一次缓存
    setInterval(() => {
      this.cleanupCache();
    }, 10 * 60 * 1000); // 10分钟
  }

  cleanupCache() {
    try {
      // 清理内存缓存
      if (this.processedComments.size > 500) {
        // 保留最近的500条
        const idsArray = Array.from(this.processedComments);
        const toKeep = idsArray.slice(-500);
        this.processedComments.clear();
        toKeep.forEach(id => this.processedComments.add(id));
        
        window.youtubeReplyLog?.debug('内存缓存已清理，保留最近500条');
      }
      
      // 清理最近处理的ID集合
      if (this.recentlyProcessedIds.size > 100) {
        const oldestId = this.recentlyProcessedIds.values().next().value;
        this.recentlyProcessedIds.delete(oldestId);
      }
      
      // 清理文本位置映射
      const now = Date.now();
      for (const [key, value] of this.lastProcessedTexts) {
        if (now - value.timestamp > 300000) { // 5分钟
          this.lastProcessedTexts.delete(key);
        }
      }
      
      // 清理位置映射
      for (const [position, data] of this.positionCommentMap) {
        if (now - data.timestamp > 300000) { // 5分钟
          this.positionCommentMap.delete(position);
        }
      }
      
    } catch (error) {
      console.error('Error cleaning up cache:', error);
    }
  }

  async init() {
    // console.log('YouTube AI Reply content script loaded');
    
    // 页面刷新时清空缓存
    this.clearCacheOnPageReload();
    
    // 强制清除所有可能存在的定时器
    this.stopAutoScroll();
    
    // 重置会话回复计数器和日志标志
    this.sessionReplyCount = 0;
    this.hasLoggedLimitReached = false;
    this.hasLoggedQueueLimitReached = false;
    this.hasLoggedScrollLimitReached = false;
    
    // 初始化日志
    if (window.youtubeReplyLog) {
      window.youtubeReplyLog.info('=== 初始化 YouTube AI Reply ===');
      window.youtubeReplyLog.info('版本:', '1.0');
      window.youtubeReplyLog.info('页面URL:', window.location.href);
      window.youtubeReplyLog.info('会话回复计数器已重置');
    } else {
      // console.log('youtubeReplyLog 未找到，日志功能不可用');
    }
    
    // 启动定期缓存清理
    this.startCacheCleanup();
    
    // 获取频道名称
    this.getChannelName();
    
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
    
    // Setup detailed scroll monitoring for debugging
    this.setupDetailedScrollMonitoring();
    
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
          autoRefreshEnabled: this.settings.autoRefreshEnabled,
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
          autoRefreshEnabled: true,
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
        autoRefreshEnabled: true,
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
          this.hasLoggedLimitReached = false;
          this.hasLoggedQueueLimitReached = false;
          this.hasLoggedScrollLimitReached = false;
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
        
        // 如果自动刷新设置有变化，显示相应的状态信息
        if (!oldSettings || oldSettings.autoRefreshEnabled !== newSettings.autoRefreshEnabled) {
          if (newSettings.autoRefreshEnabled) {
            window.youtubeReplyLog?.status('🔄 自动刷新已开启');
          } else {
            window.youtubeReplyLog?.status('⏹️ 自动刷新已关闭');
          }
        }
        
        window.youtubeReplyLog?.info('设置已更新:', { 
          autoReply: this.settings.autoReplyEnabled, 
          autoRefresh: this.settings.autoRefreshEnabled 
        });
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
        // 首先检查是否达到回复限制
        if (this.settings?.maxRepliesPerSession && 
            this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
          return; // 达到限制，不处理任何新节点
        }
        
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
    // Process existing comments only if auto-reply is enabled
    if (this.settings?.autoReplyEnabled) {
      this.processExistingComments();
    }
    
    // 不再自动启动滚动，避免无限循环
    // 系统会通过其他机制检测和处理评论
    
    // 定期检查是否有遗漏的评论（添加防抖机制）
    this.commentCheckInterval = setInterval(() => {
      // 检查基本条件
      if (!this.settings?.autoReplyEnabled) {
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        return; // 达到限制，直接返回，不进行任何处理
      }
      
      if (!this.isProcessingQueue && !this.isProcessingComments) {
        // 添加防抖，避免短时间内重复调用
        if (!this.lastCheckTime || Date.now() - this.lastCheckTime > 5000) {
          this.lastCheckTime = Date.now();
          this.processExistingComments();
        }
      }
    }, 15000); // 每15秒检查一次
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
      return text.trim().length > 0 && !text.includes('Reply') && !text.includes('Share');
    }
    
    // For containers, check if they contain comment text
    const commentText = element.querySelector('#content-text, .yt-core-attributed-string');
    if (commentText) {
      const text = commentText.textContent || '';
      return text.trim().length > 0 && !text.includes('Reply') && !text.includes('Share');
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
      
      // 检查自动回复是否启用
      if (!this.settings?.autoReplyEnabled) {
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        // 达到限制，静默返回，不设置处理标志
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
      
      window.youtubeReplyLog?.debug(`🔍 找到 ${existingComments.length} 个评论元素`);
      
      let processedCount = 0;
      let newCount = 0;
      
      // 如果队列为空，找出所有未处理的评论
      if (this.replyQueue.length === 0) {
        window.youtubeReplyLog?.debug(`🔄 队列为空，开始处理评论元素`);
        
        let commentsArray = [];
        try {
          // 按位置排序，确保从上到下处理
          commentsArray = Array.from(existingComments).map(comment => {
            window.youtubeReplyLog?.debug(`🔍 处理评论元素: ${comment.tagName}.${comment.className}`);
            const text = this.extractCommentText(comment);
            const id = this.getCommentId(comment);
            const position = this.getElementPosition(comment);
            window.youtubeReplyLog?.debug(`📝 评论提取: ID=${id}, 文本="${text?.substring(0, 20)}...", 位置=${position}`);
            return {
              element: comment,
              text: text,
              id: id,
              position: position
            };
          }).filter(comment => {
            const shouldProcess = !this.isCommentProcessed(comment.id) && 
                                  comment.text && 
                                  comment.text.trim().length > 0;
            if (!shouldProcess) {
              window.youtubeReplyLog?.debug(`⏭️ 跳过评论: ID=${comment.id}, 已处理=${this.isCommentProcessed(comment.id)}, 有文本=${!!comment.text}`);
            }
            return shouldProcess;
          }).sort((a, b) => a.position - b.position);
          
          window.youtubeReplyLog?.debug(`✅ 过滤后得到 ${commentsArray.length} 个有效评论`);
        } catch (error) {
          window.youtubeReplyLog?.error(`❌ 处理评论时发生错误: ${error.message}`);
          window.youtubeReplyLog?.debug(`错误堆栈: ${error.stack}`);
          this.isProcessingComments = false;
          return;
        }
        
        // 批量添加到队列
        window.youtubeReplyLog?.debug('准备添加到队列的评论列表:');
        commentsArray.forEach((comment, index) => {
          const displayText = comment.text || '(空内容)';
          window.youtubeReplyLog?.debug(`  ${index + 1}. 位置: ${comment.position}px, 内容: ${displayText.substring(0, 30)}...`);
        });
        
        commentsArray.forEach(comment => {
          // 添加到当前会话处理集合，防止重复加入队列
          this.recentlyProcessedIds.add(comment.id);
          if (this.recentlyProcessedIds.size > 100) {
            const oldestId = this.recentlyProcessedIds.values().next().value;
            this.recentlyProcessedIds.delete(oldestId);
          }
          
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
        } else {
          // 如果没有新评论，立即重置处理状态
          this.isProcessingComments = false;
          if (window.youtubeReplyLog?.isDebugMode) {
            window.youtubeReplyLog?.debug('没有新评论，立即重置处理状态');
          }
          return;
        }
      } else {
        window.youtubeReplyLog?.debug(`队列中已有 ${this.replyQueue.length} 条评论在等待处理`);
      }
      
      // 重置处理状态（使用更长的延迟，避免频繁调用）
      setTimeout(() => {
        this.isProcessingComments = false;
        // 只在调试模式下输出日志
        if (window.youtubeReplyLog?.isDebugMode) {
          window.youtubeReplyLog?.debug('isProcessingComments 状态已重置');
        }
      }, 3000);
      
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
        // 只在第一次达到限制时输出日志
        if (!this.hasLoggedLimitReached) {
          window.youtubeReplyLog?.status(`⏹️ 已达到回复限制 (${this.settings.maxRepliesPerSession} 条)`);
          this.hasLoggedLimitReached = true;
        }
        return;
      } else {
        // 重置标志，允许再次记录
        this.hasLoggedLimitReached = false;
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

      // 所有的评论都应该处理，不再跳过任何评论
      // Get the position of the comment
      const position = this.getElementPosition(commentElement);
      
      // 强化的重复检测机制
      // 1. 检查位置是否已经被处理过（防止相同位置的不同ID）
      if (this.positionCommentMap.has(position)) {
        const existingId = this.positionCommentMap.get(position);
        // 如果同一个位置在短时间内再次出现，很可能是重复
        if (Date.now() - (this.lastProcessedTexts.get(existingId)?.timestamp || 0) < 5000) {
          window.youtubeReplyLog?.debug(`检测到位置重复 (${position}px)，可能已处理过`);
          return;
        }
      }
      
      // Get comment ID to avoid duplicates
      const commentId = this.getCommentId(commentElement);
      
      // Skip if this is a reply
      if (commentId === 'reply_skip') {
        return;
      }
      
      // 2. 检查是否已经处理过（包括持久化缓存）
      if (this.isCommentProcessed(commentId)) {
        window.youtubeReplyLog?.debug(`评论ID已存在: ${commentId}`);
        return;
      }
      
      // 3. 检查最近处理的ID集合（用于快速查找）
      if (this.recentlyProcessedIds.has(commentId)) {
        window.youtubeReplyLog?.debug(`评论ID在最近处理过: ${commentId}`);
        return;
      }
      
      // 4. 检查文本相似度
      const authorElement = commentElement.querySelector('.author-name, .comment-author, [id="author-text"]') ||
                           commentElement.closest('.comment-renderer')?.querySelector('.author-name');
      const authorName = authorElement ? authorElement.textContent.trim().substring(0, 20) : 'unknown';
      
      if (this.hasSimilarComment(commentText, authorName)) {
        return;
      }
      
      // 5. 检查文本和位置的组合是否重复
      const textHash = this.simpleHash(commentText.substring(0, 50));
      const positionKey = `${position}_${textHash}`;
      if (this.lastProcessedTexts.has(positionKey) && 
          Date.now() - this.lastProcessedTexts.get(positionKey).timestamp < 10000) {
        window.youtubeReplyLog?.debug(`检测到文本和位置组合重复，跳过`);
        return;
      }
      
      // 6. 检查是否为频道作者自己的评论
      if (this.isChannelOwnerComment(commentElement)) {
        window.youtubeReplyLog?.info('跳过频道作者自己的评论');
        return;
      }
      
      // 7. 检查频道作者是否已经回复过该评论
      if (this.hasChannelOwnerReplied(commentElement)) {
        window.youtubeReplyLog?.info('跳过已有频道作者回复的评论');
        return;
      }
      
      // 添加到当前会话处理集合，防止重复加入队列
      this.recentlyProcessedIds.add(commentId);
      if (this.recentlyProcessedIds.size > 100) {
        // 限制大小，删除最旧的记录
        const oldestId = this.recentlyProcessedIds.values().next().value;
        this.recentlyProcessedIds.delete(oldestId);
      }
      
      // 添加到位置映射（使用更精确的位置信息）
      const positionInfo = {
        commentId,
        textHash: this.simpleHash(commentText.substring(0, 50)),
        timestamp: Date.now(),
        element: commentElement
      };
      this.positionCommentMap.set(position, positionInfo);
      
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
      window.youtubeReplyLog?.debug(`🆔 生成评论ID: 提取的文本="${commentText ? commentText.substring(0, 30) + (commentText.length > 30 ? '...' : '') : '空'}"`);
      
      if (!commentText) {
        // 无法提取文本的评论，跳过处理
        return 'skip_no_text';
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
      
      // If no stable ID found, create a simpler ID based on comment text only
      // Since we're using channel-based deduplication, we don't need author info
      const textHash = this.simpleHash(commentText);
      
      // Create simpler stable ID
      const uniqueId = `stable_${textHash}`;
      return uniqueId;
    } catch (error) {
      console.error('Error getting comment ID:', error);
      // 出错时返回跳过标记，避免生成基于时间的ID
      return 'skip_error';
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

  // 计算文本相似度（简单的Levenshtein距离实现）
  getTextSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];
    
    // 初始化矩阵
    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }
    
    // 填充矩阵
    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    const distance = matrix[len2][len1];
    const maxLength = Math.max(len1, len2);
    return maxLength === 0 ? 1 : 1 - (distance / maxLength);
  }

  // 检查是否有相似的已处理评论
  hasSimilarComment(commentText, authorName) {
    const persistentCache = this.loadPersistentCache();
    const allProcessedIds = new Set([
      ...this.processedComments,
      ...persistentCache
    ]);
    
    // 检查最近处理的文本
    for (const [key, value] of this.lastProcessedTexts) {
      if (Date.now() - value.timestamp < 60000) { // 1分钟内
        const similarity = this.getTextSimilarity(commentText, value.text);
        if (similarity > 0.8) { // 80%相似度
          window.youtubeReplyLog?.debug(`检测到相似文本 (${Math.round(similarity * 100)}%)，跳过`);
          return true;
        }
      }
    }
    
    return false;
  }
  
  getElementPosition(element) {
    // Get the Y position of the element relative to the viewport
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    
    // Return position relative to document top
    return Math.round(rect.top + scrollY);
  }
  
  // 编码文本用于缓存比较
  encodeTextForCache(text) {
    // 使用 TextEncoder 将文本转换为 UTF-8 字节数组
    // 然后转换为 base64 字符串，确保 emoji 和特殊字符的一致性
    const normalizedText = text.trim()
      .replace(/\s+/g, ' ')  // 标准化空格
      .replace(/\uFE0F/g, ''); // 移除 emoji 变体选择器
    
    const encoder = new TextEncoder();
    const bytes = encoder.encode(normalizedText);
    return btoa(String.fromCharCode(...bytes));
  }

  isOwnReply(text) {
    // 检查是否在回复缓存中（使用编码后的文本）
    // 这个方法主要用于在MutationObserver中快速过滤
    if (this.myReplyCache && this.myReplyCache.has(this.encodeTextForCache(text))) {
      window.youtubeReplyLog?.debug('检测到自己的回复（缓存匹配）:', text.substring(0, 30));
      return true;
    }
    
    return false;
  }

  // 获取当前频道名称
  getChannelName() {
    if (this.channelName) {
      return this.channelName;
    }
    
    // 尝试从多个位置获取频道名称 - 优先从页面主体结构，但也从评论区获取
    const selectors = [
      // 方法1: 从导航栏频道名称文本获取 (页面主体结构)
      '.ytcp-navigation-drawer #entity-name',
      // 方法2: 从导航栏缩略图alt属性获取 (页面主体结构)
      '.ytcp-navigation-drawer .thumbnail.image-thumbnail[alt]',
      // 方法3: 从评论区心形图标获取 (评论区结构)
      '.ytcp-comment-creator-heart #img[alt^="@"]',
      // 方法4: 从评论区头像获取 (评论区结构)
      '.ytcp-comment #avatar img[alt^="@"]',
      // 方法5: 从页面标题或其他主体结构获取
      '.ytcp-entity-page [data-channel-name]',
      '.ytcp-app [data-channel-name]',
      // 方法6: 从YouTube Studio 页面其他位置获取
      'ytcp-channel-name .ytcp-text-field-label',
      'ytcp-channel-name #channel-name',
      '#channel-name .ytcp-text-field-label'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        let name = '';
        
        // 处理不同类型的元素
        if (element.tagName === 'IMG') {
          // 从img的alt属性获取
          name = element.getAttribute('alt') || '';
        } else {
          // 从文本内容获取
          name = element.textContent.trim();
        }
        
        // 验证名称有效性 - 不做格式转换
        if (name && 
            name !== '频道名称' && 
            name !== '频道' && 
            name !== '我的频道' &&
            name.length > 2 &&
            !name.includes('YouTube') &&
            !name.includes('Studio')) {
          
          // 移除@符号（如果有）
          if (name.startsWith('@')) {
            name = name.substring(1);
          }
          
          this.channelName = name;
          window.youtubeReplyLog?.info(`✅ 获取到频道名称: ${name} (来源: ${selector})`);
          return name;
        }
      }
    }
    
    // 如果仍然无法获取，尝试从URL中提取频道信息
    try {
      const urlMatch = window.location.href.match(/\/channel\/([^\/]+)\//);
      if (urlMatch && urlMatch[1]) {
        const channelId = urlMatch[1];
        // 如果能找到频道ID但找不到名称，使用一个通用标识
        this.channelName = `Channel_${channelId.substring(0, 8)}`;
        window.youtubeReplyLog?.info(`🔗 从URL获取到频道ID: ${channelId}，使用简化名称: ${this.channelName}`);
        return this.channelName;
      }
    } catch (error) {
      window.youtubeReplyLog?.debug('从URL提取频道信息失败:', error);
    }
    
    // 最后的备用方案：使用默认名称
    this.channelName = 'Ai_Music_Bella'; // 根据用户提供的默认值
    window.youtubeReplyLog?.warning(`⚠️ 未找到频道名称，使用默认值: ${this.channelName}`);
    return this.channelName;
  }

  // 检查评论是否来自频道作者
  isChannelOwnerComment(commentElement) {
    const channelName = this.getChannelName();
    
    // 方法1: 检查作者名称
    const authorElement = commentElement.querySelector('.author-name, .comment-author, [id="author-text"], .author-text') ||
                         commentElement.closest('.comment-renderer')?.querySelector('.author-name') ||
                         commentElement.closest('ytcp-comment')?.querySelector('#name a');
    
    if (authorElement) {
      const authorName = authorElement.textContent.trim();
      if (authorName === channelName || authorName === `@${channelName}`) {
        window.youtubeReplyLog?.debug(`检测到频道作者自己的评论: ${authorName}`);
        return true;
      }
    }
    
    // 方法2: 检查是否有频道作者标识
    const ownerBadge = commentElement.querySelector(this.channelOwnerSelector);
    if (ownerBadge) {
      window.youtubeReplyLog?.debug('检测到频道作者标识徽章');
      return true;
    }
    
    // 方法3: 检查是否在YouTube Studio环境且有creator标识
    const comment = commentElement.closest('ytcp-comment');
    if (comment) {
      const badgeElement = comment.querySelector('ytcp-author-comment-badge[is-creator]');
      if (badgeElement) {
        window.youtubeReplyLog?.debug('检测到YouTube Studio创作者标识');
        return true;
      }
    }
    
    return false;
  }

  // 检查频道作者是否已经回复过该评论
  hasChannelOwnerReplied(commentElement) {
    const channelName = this.getChannelName();
    
    // 获取评论的回复区域
    const replySection = commentElement.closest('ytcp-comment-thread')?.querySelector('ytcp-comment-replies') ||
                        commentElement.closest('.comment-thread')?.querySelector('.comment-thread-replies');
    
    if (!replySection) {
      return false;
    }
    
    // 检查所有回复
    const replies = replySection.querySelectorAll('ytcp-comment[is-reply], .comment-reply, ytd-comment-renderer[is-reply]');
    
    for (const reply of replies) {
      // 检查回复者是否是频道作者
      const replyAuthor = reply.querySelector('.author-name, .comment-author, [id="author-text"], .author-text') ||
                          reply.querySelector('#name a') ||
                          reply.querySelector('ytcp-author-comment-badge[is-creator] a');
      
      if (replyAuthor) {
        const replyAuthorName = replyAuthor.textContent.trim();
        if (replyAuthorName === channelName || replyAuthorName === `@${channelName}`) {
          window.youtubeReplyLog?.debug('检测到频道作者已经回复过该评论');
          return true;
        }
      }
      
      // 检查是否有创作者徽章
      const creatorBadge = reply.querySelector(this.channelOwnerSelector);
      if (creatorBadge) {
        window.youtubeReplyLog?.debug('检测到频道作者的回复徽章');
        return true;
      }
    }
    
    return false;
  }


  isPureEmoji(text) {
    window.youtubeReplyLog?.debug(`🔍 检查纯表情评论: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    
    // 检查是否只包含表情图片标签（YouTube Studio格式）
    const imgEmojiRegex = /<img[^>]*alt="([^"]*)"[^>]*class="[^"]*emoji[^"]*"[^>]*>/gi;
    const imgMatches = text.match(imgEmojiRegex);
    
    // 检查是否有任何非表情图片的内容
    const nonImgContent = text.replace(imgEmojiRegex, '').trim();
    
    // 如果只有表情图片且没有其他内容，则认为是纯表情评论
    if (imgMatches && imgMatches.length > 0 && nonImgContent.length === 0) {
      window.youtubeReplyLog?.debug(`🎭 检测到图片表情评论: ${imgMatches.length} 个表情图片`);
      return true;
    }
    
    // 检查Unicode表情符号
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F270}]|[\u{238C}]|[\u{2020}]|[\u{2B06}]|[\u{2197}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{3297}]|[\u{3299}]|[\u{3030}]|[\u{2B50}]|[\u{2B55}]/gu;
    const textWithoutEmojis = text.replace(emojiRegex, '').trim();
    const emojiCount = (text.match(emojiRegex) || []).length;
    
    const isPureUnicodeEmoji = emojiCount > 0 && textWithoutEmojis.length === 0;
    
    window.youtubeReplyLog?.debug(`📊 评论分析: 图片表情=${imgMatches ? imgMatches.length : 0}, Unicode表情=${emojiCount}, 其他内容=${nonImgContent.length > 0 ? '"' + nonImgContent + '"' : '无'}, 纯Unicode表情=${isPureUnicodeEmoji}`);
    
    return isPureUnicodeEmoji;
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
        // Extract both text and emoji images
        const emojiImages = commentElement.querySelectorAll('img.small-emoji.emoji');
        let combinedText = '';
        
        if (emojiImages.length > 0) {
          // Clone the element to manipulate it
          const clonedElement = commentElement.cloneNode(true);
          
          // Replace each emoji image with its alt text
          const emojiImgs = clonedElement.querySelectorAll('img.small-emoji.emoji');
          emojiImgs.forEach(img => {
            const altText = img.alt || '';
            img.replaceWith(document.createTextNode(altText));
          });
          
          // Get the complete text content including emojis
          combinedText = clonedElement.textContent.trim();
          window.youtubeReplyLog?.debug(`🎭 提取到混合评论: ${emojiImages.length} 个表情, 完整内容: "${combinedText}"`);
        } else {
          combinedText = commentElement.textContent.trim();
        }
        
        return combinedText;
      }
      
      // Find the comment text element using multiple selectors
      const textElement = commentElement.querySelector('#content-text') ||
                         commentElement.querySelector('.yt-core-attributed-string') ||
                         commentElement.querySelector('yt-formatted-string#content-text');
      
      if (textElement) {
        // Extract both text and emoji images
        const emojiImages = textElement.querySelectorAll('img.small-emoji.emoji');
        let combinedText = '';
        
        if (emojiImages.length > 0) {
          // Clone the element to manipulate it
          const clonedElement = textElement.cloneNode(true);
          
          // Replace each emoji image with its alt text
          const emojiImgs = clonedElement.querySelectorAll('img.small-emoji.emoji');
          emojiImgs.forEach(img => {
            const altText = img.alt || '';
            img.replaceWith(document.createTextNode(altText));
          });
          
          // Get the complete text content including emojis
          combinedText = clonedElement.textContent.trim();
          window.youtubeReplyLog?.debug(`🎭 提取到混合评论: ${emojiImages.length} 个表情, 完整内容: "${combinedText}"`);
        } else {
          combinedText = textElement.textContent.trim();
        }
        
        return combinedText;
      }
      
      // If the element is yt-formatted-string with content-text id
      if (commentElement.tagName === 'YT-FORMATTED-STRING' && commentElement.id === 'content-text') {
        // Extract both text and emoji images
        const emojiImages = commentElement.querySelectorAll('img.small-emoji.emoji');
        let combinedText = '';
        
        if (emojiImages.length > 0) {
          // Clone the element to manipulate it
          const clonedElement = commentElement.cloneNode(true);
          
          // Replace each emoji image with its alt text
          const emojiImgs = clonedElement.querySelectorAll('img.small-emoji.emoji');
          emojiImgs.forEach(img => {
            const altText = img.alt || '';
            img.replaceWith(document.createTextNode(altText));
          });
          
          // Get the complete text content including emojis
          combinedText = clonedElement.textContent.trim();
          window.youtubeReplyLog?.debug(`🎭 提取到混合评论: ${emojiImages.length} 个表情, 完整内容: "${combinedText}"`);
        } else {
          combinedText = commentElement.textContent.trim();
        }
        
        return combinedText;
      }
      
      // Last resort - use the element's text if it looks like a comment
      const text = commentElement.textContent.trim();
      if (text.length > 0 && !text.includes('Reply') && !text.includes('Share')) {

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
            await this.generateAndPostReply(comment, processedCount, totalInQueue);
            
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
          if (!this.hasLoggedQueueLimitReached) {
            window.youtubeReplyLog?.status(`⏹️ 已达到回复限制 (${this.settings.maxRepliesPerSession} 条)，停止处理`);
            this.hasLoggedQueueLimitReached = true;
          }
          break;
        }
      }
      
      window.youtubeReplyLog?.success(`队列处理完成，共处理 ${processedCount} 条评论`);
      
    } finally {
      this.isProcessingQueue = false;
      
      // 队列处理完成后，不再自动启动滚动
      // 避免无限循环：处理完成 → 滚动 → 再次处理 → 循环
      // 如果需要加载更多评论，用户应手动滚动
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
        // 停止观察者，避免继续检测新评论
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
          window.youtubeReplyLog?.debug('已停止MutationObserver');
        }
        return false;
      }
    }

    // 检查是否是频道作者自己的评论
    if (this.isChannelOwnerComment(comment.element)) {
      window.youtubeReplyLog?.debug('跳过频道作者自己的评论');
      return false;
    }
    
    // 检查频道作者是否已经回复过该评论
    if (this.hasChannelOwnerReplied(comment.element)) {
      window.youtubeReplyLog?.debug('跳过已有频道作者回复的评论');
      return false;
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

  async generateAndPostReply(comment, queuePosition = 1, totalInQueue = 1) {
    try {
      // 更新活动时间
      this.updateActivity();
      
      // 获取当前回复编号（使用会话计数器）
      // 使用传入的队列位置显示
      
      // 更新回复编号显示
      if (window.youtubeReplyLog) {
        window.youtubeReplyLog.step(`📝 正在回复第 ${queuePosition} 条评论`);
      }
      
      window.youtubeReplyLog?.processing('💭 正在生成回复内容...');
      window.youtubeReplyLog?.debug(`📄 原评论: ${comment.commentText.substring(0, 50)}...`);

      // 声明回复文本变量
      let replyText;
      let aiResponse = null;

      // 检查是否为纯表情评论，如果是则直接使用指定回复
      if (this.isPureEmoji(comment.commentText)) {
        window.youtubeReplyLog?.info('🎭 检测到纯表情评论，使用指定回复');
        replyText = '🤍🤍🩵🩵❤️❤️❤️‍🔥❤️‍🔥😻😻🌹🌹💓💓🫶🫶';
        window.youtubeReplyLog?.success('✅ 已使用纯表情回复');
        window.youtubeReplyLog?.info(`💬 回复内容: ${replyText}`);
      } else {
        // 非表情评论，使用AI生成回复
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
          // AI请求失败，使用默认回复
          window.youtubeReplyLog?.warning(`⚠️ AI请求失败: ${error.message}`);
          window.youtubeReplyLog?.info('🔧 使用默认回复: 🖤');
          
          // 使用默认回复
          replyText = '🖤';
          
          // 跳过AI响应处理，直接发布回复
          window.youtubeReplyLog?.success('✅ 已使用默认回复');
          window.youtubeReplyLog?.info(`💬 回复内容: ${replyText}`);
        }

        // 保存AI响应信息用于后续操作
        aiResponse = response ? response.reply : null;
        
        // 如果replyText已经在catch块中设置（使用默认回复），则跳过AI响应处理
        if (replyText === '🖤') {
          // 已经使用默认回复，不需要处理AI响应
        } else {
          // 处理正常的AI响应
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
      }

      // 确保replyText有定义
      if (!replyText) {
        window.youtubeReplyLog?.error('❌ 回复内容未生成，使用默认回复');
        replyText = '🖤';
      }

      // Post the reply
      window.youtubeReplyLog?.step('📤 正在发布回复...');
      await this.postReply(comment.element, replyText);

      // 根据AI判断执行点赞和点红心操作（仅在使用AI回复时）
      if (replyText !== '🖤' && replyText !== '🤍🤍🩵🩵❤️❤️❤️‍🔥❤️‍🔥😻😻🌹🌹💓💓🫶🫶' && typeof aiResponse === 'object' && aiResponse !== null && aiResponse.actions) {
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

      // 只有在回复真正发布成功后才增加计数器
      // 注意：计数器在最后增加
      
      // 将回复内容添加到缓存，避免重复回复
      if (replyText) {
        // 使用编码后的文本作为缓存键
        const encodedReplyText = this.encodeTextForCache(replyText);
        this.myReplyCache.add(encodedReplyText);
        // 限制缓存大小，避免内存泄漏
        if (this.myReplyCache.size > 100) {
          // 如果缓存超过100条，删除最早的一半
          const entries = Array.from(this.myReplyCache);
          this.myReplyCache.clear();
          entries.slice(50).forEach(entry => this.myReplyCache.add(entry));
        }
        window.youtubeReplyLog?.debug(`回复内容已添加到缓存，当前缓存大小: ${this.myReplyCache.size}`);
      }
      
      // 回复成功，增加计数器
      await this.incrementReplyCount();
      this.sessionReplyCount++; // 增加会话回复计数
      
      // 只有在回复真正成功后才标记为已处理
      this.markCommentAsProcessed(comment.commentId);
      window.youtubeReplyLog?.debug(`评论 ${comment.commentId} 已标记为已处理`);
      
      // 从当前会话处理集合中移除
      this.recentlyProcessedIds.delete(comment.commentId);
      
      // 更新贴边按钮显示为会话计数器
      if (window.youtubeReplyLog) {
        const maxReplies = this.settings?.maxRepliesPerSession || 10;
        window.youtubeReplyLog.updateReplyCount(this.sessionReplyCount, maxReplies);
      }
      
      window.youtubeReplyLog?.success(`🎉 第 ${this.sessionReplyCount} 条回复完成！`);

    } catch (error) {
      console.error('Error generating/posting reply:', error);
      
      // 回复失败时，从当前会话处理集合中移除，允许重新处理
      this.recentlyProcessedIds.delete(comment.commentId);
      window.youtubeReplyLog?.debug(`评论 ${comment.commentId} 已从会话处理集合中移除，允许重新处理`);
      
      // 回复失败时，不增加计数器，所以不需要回滚
      // 只显示错误信息
      window.youtubeReplyLog?.error(`回复失败: ${error.message}`);
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
      
      // 检查自动回复是否启用
      if (!this.settings?.autoReplyEnabled) {
        this.stopAutoScroll();
        return;
      }
      
      // 检查是否达到回复限制
      if (this.settings?.maxRepliesPerSession && 
          this.sessionReplyCount >= this.settings.maxRepliesPerSession) {
        this.stopAutoScroll();
        if (!this.hasLoggedScrollLimitReached) {
          window.youtubeReplyLog?.status('⏹️ 已达到回复限制，停止自动滚动');
          this.hasLoggedScrollLimitReached = true;
        }
        return;
      }
      
      const now = Date.now();
      // 至少间隔15秒才滚动一次
      if (now - this.lastScrollTime < 15000) {
        return;
      }
      
      // 获取正确的滚动容器
      const scrollContainer = this.findScrollContainer();
      if (!scrollContainer) {
        return;
      }
      
      // 获取滚动位置信息
      let scrollTop, scrollHeight, clientHeight;
      if (scrollContainer === window) {
        scrollTop = window.scrollY || document.documentElement.scrollTop;
        scrollHeight = document.documentElement.scrollHeight;
        clientHeight = window.innerHeight;
      } else {
        scrollTop = scrollContainer.scrollTop;
        scrollHeight = scrollContainer.scrollHeight;
        clientHeight = scrollContainer.clientHeight;
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
      
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      
      // 如果距离底部超过1000px，则向下滚动
      if (distanceFromBottom > 1000) {
        const scrollAmount = Math.min(600, distanceFromBottom / 2);
        const targetScroll = scrollTop + scrollAmount;
        
        // 使用直接设置scrollTop而不是smooth滚动，更可靠
        if (scrollContainer === window) {
          window.scrollTo(0, targetScroll);
        } else {
          scrollContainer.scrollTop = targetScroll;
        }
        
        this.lastScrollTime = now;
        window.youtubeReplyLog?.debug(`自动向下滚动 ${scrollAmount}px，距离底部 ${distanceFromBottom}px`);
        
        // 滚动后检查新评论
        setTimeout(() => {
          this.checkForNewCommentsAfterScroll();
        }, 3000);
      } else {
        window.youtubeReplyLog?.debug(`已接近底部，距离底部 ${distanceFromBottom}px`);
      }
      
    } catch (error) {
      console.error('Error in auto-scroll:', error);
    }
  }
  
  findScrollContainer() {
    // 查找主要的滚动容器 - 优先使用ytcp-activity-section
    const containers = [
      document.querySelector('ytcp-activity-section'),
      document.querySelector('#primary-inner'),
      document.querySelector('#primary'),
      document.querySelector('#comments'),
      document.querySelector('.ytcp-app')
    ].filter(Boolean);
    
    for (const container of containers) {
      if (container && container.scrollHeight > container.clientHeight) {
        console.log(`🎯 找到滚动容器: ${container.tagName.toLowerCase()}, 高度: ${container.scrollHeight}px`);
        return container;
      }
    }
    
    console.log('⚠️ 未找到合适的滚动容器，使用window');
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
      document.querySelector('ytd-app'),
      document.querySelector('ytcp-activity-section')  // 关键：添加实际的滚动容器
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
  
  // 简化的滚动监测方法 - 专注于关键信息
  setupDetailedScrollMonitoring() {
    console.log('🔍 滚动监测已启动 - 修复版本');
    
    // 监听主要的滚动容器
    const mainContainer = document.querySelector('ytcp-activity-section');
    if (mainContainer) {
      mainContainer.addEventListener('scroll', (event) => {
        const scrollTop = mainContainer.scrollTop;
        const scrollHeight = mainContainer.scrollHeight;
        const clientHeight = mainContainer.clientHeight;
        const scrollPercent = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
        
        // 滚动日志已清理
      });
    }
    
    // 监听window滚动（作为备用）
    window.addEventListener('scroll', (event) => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      // Window滚动日志已清理
    });
  }
  
  checkForNewCommentsAfterScroll() {
    // 简化版本，只在需要时处理
    if (!this.isProcessingQueue && 
        !this.isProcessingComments &&
        this.settings?.autoReplyEnabled && // 检查自动回复是否启用
        (!this.settings?.maxRepliesPerSession || 
         this.sessionReplyCount < this.settings.maxRepliesPerSession)) {
      // 添加防抖，避免短时间内重复调用
      if (!this.lastScrollCheckTime || Date.now() - this.lastScrollCheckTime > 30000) { // 增加到30秒
        this.lastScrollCheckTime = Date.now();
        
        // 只有在距离上次处理超过60秒时才处理
        if (this.lastProcessingTime && Date.now() - this.lastProcessingTime < 60000) {
          return;
        }
        
        // 简化检查：如果所有评论都已被处理，则不再处理
        const comments = Array.from(document.querySelectorAll(
          'ytcp-comment-thread ytcp-comment #content-text, ' +
          'ytcp-comment #content-text, ' +
          '#content-text.yt-core-attributed-string'
        ));
        window.youtubeReplyLog?.debug(`滚动检查：找到 ${comments.length} 个评论文本元素`);
        
        const hasUnprocessedComments = comments.some(comment => {
          const commentId = this.getCommentId(comment);
          const commentText = this.extractCommentText(comment);
          window.youtubeReplyLog?.debug(`🔍 滚动检查评论: ID=${commentId}, 文本="${commentText ? commentText.substring(0, 20) + (commentText.length > 20 ? '...' : '') : '空'}", 已处理=${this.isCommentProcessed(commentId)}`);
          
          // 跳过无法处理的评论
          if (commentId.startsWith('skip_')) {
            window.youtubeReplyLog?.debug(`⏭️ 跳过评论: ${commentId} (原因: ${commentId})`);
            return false;
          }
          // 检查是否为未处理的评论
          const isUnprocessed = commentId !== 'reply_skip' && !this.isCommentProcessed(commentId);
          if (isUnprocessed) {
            window.youtubeReplyLog?.debug(`✅ 发现未处理评论：${commentId}`);
          } else {
            window.youtubeReplyLog?.debug(`⛔ 评论已处理或跳过：${commentId}`);
          }
          return isUnprocessed;
        });
        
        if (hasUnprocessedComments) {
          window.youtubeReplyLog?.debug('滚动检查：发现未处理评论，开始处理');
          this.lastProcessingTime = Date.now();
          this.processExistingComments();
        } else {
          window.youtubeReplyLog?.debug('滚动检查：所有评论已处理，跳过');
        }
      }
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
            
            // 检查新加载的评论（仅在未达到回复限制时）
            if (!this.settings?.maxRepliesPerSession || 
                this.sessionReplyCount < this.settings.maxRepliesPerSession) {
              await this.processExistingComments();
            }
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
            
            // 再次检查评论（仅在未达到回复限制时）
            if (!this.settings?.maxRepliesPerSession || 
                this.sessionReplyCount < this.settings.maxRepliesPerSession) {
              await this.processExistingComments();
            }
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
  
  if (request.action === 'settingsChanged') {
    // 更新所有设置
    const oldSettings = commentMonitor.settings;
    commentMonitor.settings = { ...request.settings };
    
    // 检查自动刷新设置的变化
    if (oldSettings.autoRefreshEnabled !== request.settings.autoRefreshEnabled) {
      if (request.settings.autoRefreshEnabled) {
        window.youtubeReplyLog?.status('🔄 自动刷新已开启');
      } else {
        window.youtubeReplyLog?.status('⏹️ 自动刷新已关闭');
      }
    }
    
    // 更新日志显示的最大回复数
    if (window.youtubeReplyLog) {
      const maxReplies = commentMonitor.settings.maxRepliesPerSession || 10;
      window.youtubeReplyLog.updateReplyCount(commentMonitor.sessionReplyCount, maxReplies);
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
    
    // 添加调试日志
    window.youtubeReplyLog?.debug(`🔍 检查不活动状态: 不活动时间=${Math.floor(inactiveTime/1000)}秒, autoReplyEnabled=${this.settings?.autoReplyEnabled}, autoRefreshEnabled=${this.settings?.autoRefreshEnabled}`);
    
    // 如果2分钟没有活动且启用了自动刷新，则刷新页面
    if (inactiveTime > 120000 && this.settings?.autoReplyEnabled && this.settings?.autoRefreshEnabled !== false) {
      window.youtubeReplyLog?.warning('⚠️ 长时间无活动，即将刷新页面');
      
      // 延迟2秒后刷新页面，让日志有时间显示
      setTimeout(() => {
        window.youtubeReplyLog?.info('🔄 刷新页面中...');
        window.location.reload();
      }, 2000);
    }
  };
  
  // 每分钟检查一次
  setInterval(checkInactivity, 60000);
};

YouTubeCommentMonitor.prototype.updateActivity = function() {
  this.lastActivityTime = Date.now();
};

YouTubeCommentMonitor.prototype.stopAutoReply = function(clearRestartTimer = true) {
  // 停止所有自动回复活动
  this.stopAutoScroll();
  this.isProcessingQueue = false;
  this.replyQueue = [];
  
  // 清理重启定时器（除非指定不清理）
  if (clearRestartTimer && this.restartTimer) {
    window.youtubeReplyLog?.debug('🧹 清理重启定时器');
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
  
  // 更新设置
  if (this.settings) {
    this.settings.autoReplyEnabled = false;
    // 重置所有日志标志
    this.hasLoggedLimitReached = false;
    this.hasLoggedQueueLimitReached = false;
    this.hasLoggedScrollLimitReached = false;
    chrome.storage.sync.set({ settings: this.settings }, () => {
      window.youtubeReplyLog?.status('⏸️ 自动回复已停止');
    });
  }
};


YouTubeCommentMonitor.prototype.scrollDownAfterReply = async function() {
  try {
    // 等待一下确保回复已经完全提交
    await this.sleep(1000);
    
    // 获取正确的滚动容器
    const scrollContainer = this.findScrollContainer();
    
    // 获取当前滚动位置
    let currentScroll;
    if (scrollContainer === window) {
      currentScroll = window.scrollY || document.documentElement.scrollTop;
    } else {
      currentScroll = scrollContainer.scrollTop;
    }
    
    const targetScroll = currentScroll + 230;
    
    window.youtubeReplyLog?.debug(`向下滚动 230px (从 ${currentScroll} 到 ${targetScroll})`);
    window.youtubeReplyLog?.debug(`使用滚动容器: ${scrollContainer === window ? 'window' : scrollContainer.tagName.toLowerCase()}`);
    
    // 尝试多种滚动方法
    let scrollSuccess = false;
    
    // 方法1：直接设置scrollTop（最可靠）
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
    
    // 方法3：对于内部容器，使用focus trick
    if (!scrollSuccess && scrollContainer !== window) {
      try {
        // 查找容器内的一个元素并focus，然后滚动
        const focusElement = scrollContainer.querySelector('ytcp-comment-thread') || 
                           scrollContainer.querySelector('#content-text') ||
                           scrollContainer.querySelector('.comment-thread');
        
        if (focusElement) {
          focusElement.focus();
          await this.sleep(50);
          
          // 再次尝试设置scrollTop
          scrollContainer.scrollTop = targetScroll;
          await this.sleep(100);
          
          const actualScroll = scrollContainer.scrollTop;
          if (Math.abs(actualScroll - targetScroll) < 50) {
            scrollSuccess = true;
            window.youtubeReplyLog?.debug('方法3成功: focus + scrollTop');
          }
        }
      } catch (e) {
        window.youtubeReplyLog?.debug(`方法3失败: ${e.message}`);
      }
    }
    
    // 验证最终结果
    const finalScroll = scrollContainer === window ? 
      (window.scrollY || document.documentElement.scrollTop) : 
      scrollContainer.scrollTop;
    const scrollDiff = finalScroll - currentScroll;
    
    window.youtubeReplyLog?.debug(`最终滚动距离: ${scrollDiff}px`);
    
    if (!scrollSuccess) {
      window.youtubeReplyLog?.warning('⚠️ 滚动可能未按预期工作，但继续执行');
    } else {
      window.youtubeReplyLog?.success('✅ 滚动执行成功');
    }
    
  } catch (error) {
    console.error('Error scrolling down after reply:', error);
    window.youtubeReplyLog?.error(`滚动出错: ${error.message}`);
  }
};

// 添加清理方法
YouTubeCommentMonitor.prototype.cleanup = function() {
  // 清理所有定时器和观察者
  if (this.observer) {
    this.observer.disconnect();
  }
  
  // 添加日志，检查是否意外清理了重启定时器
  if (this.restartTimer) {
    window.youtubeReplyLog?.warning('⚠️ 清理时发现重启定时器存在，正在清除');
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
  
  this.observer = null;
  
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

