// Content script for YouTube comment detection and reply
class YouTubeCommentMonitor {
  constructor() {
    this.observer = null;
    this.processedComments = new Set();
    this.replyQueue = [];
    this.isProcessing = false;
    this.settings = null;
    
    this.init();
  }

  async init() {
    console.log('YouTube AI Reply content script loaded');
    
    // Wait for settings to load
    await this.loadSettings();
    
    // Start monitoring for comments
    this.startCommentMonitoring();
    
    // Listen for settings changes
    this.listenForSettingsChanges();
  }

  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response.success) {
        this.settings = response.settings;
        console.log('Settings loaded:', this.settings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        this.settings = changes.settings.newValue;
        console.log('Settings updated:', this.settings);
      }
    });
  }

  startCommentMonitoring() {
    // Wait for comments section to load
    const waitForComments = () => {
      const commentsSection = document.querySelector('#comments');
      if (commentsSection) {
        this.setupCommentObserver();
        this.processExistingComments();
      } else {
        setTimeout(waitForComments, 1000);
      }
    };

    waitForComments();
  }

  setupCommentObserver() {
    const commentsSection = document.querySelector('#comments');
    if (!commentsSection) return;

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (this.isCommentElement(node)) {
            this.processNewComment(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node contains comments
            const comments = node.querySelectorAll('#comment #content');
            comments.forEach(comment => this.processNewComment(comment));
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

    console.log('Comment observer started');
  }

  isCommentElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) return false;
    
    // Check various YouTube comment element selectors
    return element.id === 'comment' || 
           element.closest('#comment') ||
           element.tagName === 'YTD-COMMENT-THREAD-RENDERER' ||
           element.querySelector('#comment') ||
           element.querySelector('#comment-text') ||
           element.querySelector('.ytd-comment-thread-renderer');
  }

  processExistingComments() {
    const existingComments = document.querySelectorAll('#comment #content, ytd-comment-thread-renderer #content-text, .ytd-comment-thread-renderer #content-text');
    existingComments.forEach(comment => this.processNewComment(comment));
  }

  async processNewComment(commentElement) {
    if (!this.settings?.autoReplyEnabled) {
      return;
    }

    // Get comment ID to avoid duplicates
    const commentId = this.getCommentId(commentElement);
    if (this.processedComments.has(commentId)) {
      return;
    }

    // Mark as processed
    this.processedComments.add(commentId);

    // Extract comment text
    const commentText = this.extractCommentText(commentElement);
    if (!commentText || commentText.trim().length < 10) {
      return;
    }

    console.log('New comment detected:', commentText.substring(0, 100) + '...');

    // Add to reply queue
    this.replyQueue.push({
      commentId,
      commentText,
      element: commentElement,
      timestamp: Date.now()
    });

    // Process reply queue
    this.processReplyQueue();
  }

  getCommentId(commentElement) {
    // Try to get a unique identifier for the comment
    const comment = commentElement.closest('#comment');
    if (comment) {
      return comment.id || comment.getAttribute('data-comment-id') || 
             Math.random().toString(36).substr(2, 9);
    }
    return Math.random().toString(36).substr(2, 9);
  }

  extractCommentText(commentElement) {
    try {
      // Find the comment text element using multiple selectors
      const textElement = commentElement.querySelector('#content-text') ||
                         commentElement.querySelector('#content-text #content') ||
                         commentElement.querySelector('.yt-core-attributed-string') ||
                         commentElement.querySelector('[id*="content-text"]') ||
                         commentElement.querySelector('.ytd-comment-renderer #content-text') ||
                         commentElement.querySelector('ytd-comment-renderer #content-text');
      
      if (textElement) {
        const text = textElement.textContent.trim();
        console.log('Extracted comment text:', text.substring(0, 100) + '...');
        return text;
      }
      
      // Fallback: try to find text in the comment element
      const comment = commentElement.closest('#comment') || 
                     commentElement.closest('ytd-comment-thread-renderer') ||
                     commentElement.closest('ytd-comment-renderer');
      
      if (comment) {
        const text = comment.textContent.trim();
        // Remove common non-content text
        return text.replace(/Reply|Share|More|Like|Dislike|\d+ (seconds?|minutes?|hours?|days?|weeks?|months?|years? ago)/gi, '').trim();
      }
    } catch (error) {
      console.error('Error extracting comment text:', error);
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
      
      // Check if we should reply to this comment
      if (await this.shouldReplyToComment(comment)) {
        await this.generateAndPostReply(comment);
      }

      // Add delay between replies
      await this.sleep(this.settings?.replyDelay || 3000);
    }

    this.isProcessing = false;
  }

  async shouldReplyToComment(comment) {
    // Check if auto-reply is enabled
    if (!this.settings?.autoReplyEnabled) {
      return false;
    }

    // Check reply limit
    if (this.settings?.maxRepliesPerSession) {
      const today = new Date().toDateString();
      const replyCount = await this.getTodayReplyCount();
      if (replyCount >= this.settings.maxRepliesPerSession) {
        console.log('Maximum replies reached for today');
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
      console.log('Generating reply for:', comment.commentText.substring(0, 50) + '...');

      // Generate AI reply
      const response = await chrome.runtime.sendMessage({
        action: 'generateReply',
        commentText: comment.commentText,
        replyStyle: this.settings?.replyStyle || 'friendly'
      });

      if (!response.success) {
        throw new Error(response.error);
      }

      const replyText = response.reply;
      console.log('Generated reply:', replyText);

      // Post the reply
      await this.postReply(comment.element, replyText);

      // Increment reply count
      await this.incrementReplyCount();

      console.log('Reply posted successfully');

    } catch (error) {
      console.error('Error generating/posting reply:', error);
    }
  }

  async postReply(commentElement, replyText) {
    try {
      console.log('Attempting to post reply...');
      
      // Find the reply button using multiple selectors
      const replyButton = this.findReplyButton(commentElement);
      
      if (!replyButton) {
        throw new Error('Reply button not found');
      }

      console.log('Found reply button, clicking...');
      replyButton.click();
      await this.sleep(1500);

      // Find reply input box
      const replyInput = this.findReplyInput();
      
      if (!replyInput) {
        throw new Error('Reply input not found');
      }

      console.log('Found reply input, typing text...');
      replyInput.focus();
      await this.typeText(replyInput, replyText);

      // Find and click post button
      const postButton = this.findPostButton();
      
      if (!postButton) {
        throw new Error('Post button not found');
      }

      console.log('Found post button, clicking...');
      postButton.click();
      await this.sleep(2000);

      console.log('Reply posted successfully');
      return true;

    } catch (error) {
      console.error('Error posting reply:', error);
      throw error;
    }
  }

  findReplyButton(commentElement) {
    const comment = commentElement.closest('#comment') || 
                   commentElement.closest('ytd-comment-thread-renderer') ||
                   commentElement.closest('ytd-comment-renderer');
    
    if (!comment) return null;

    // Try multiple selectors for reply button
    return comment.querySelector('button[aria-label*="Reply"]') ||
           comment.querySelector('button[aria-label*="reply"]') ||
           comment.querySelector('button[title*="Reply"]') ||
           comment.querySelector('button[title*="reply"]') ||
           comment.querySelector('.ytd-comment-action-buttons-renderer button') ||
           comment.querySelector('#reply-button-end');
  }

  findReplyInput() {
    // Try multiple selectors for reply input
    return document.querySelector('div[contenteditable="true"]#contenteditable-root') ||
           document.querySelector('div[contenteditable="true"]') ||
           document.querySelector('#contenteditable-root') ||
           document.querySelector('.comment-simplebox-renderer div[contenteditable="true"]') ||
           document.querySelector('ytd-comment-reply-dialog-renderer div[contenteditable="true"]');
  }

  findPostButton() {
    // Try multiple selectors for post button
    return document.querySelector('button[aria-label*="Comment"]') ||
           document.querySelector('button[aria-label*="Post"]') ||
           document.querySelector('button[aria-label*="comment"]') ||
           document.querySelector('button[aria-label*="post"]') ||
           document.querySelector('button#submit-button') ||
           document.querySelector('button#submit-button-end') ||
           document.querySelector('.ytd-comment-reply-dialog-renderer button[type="submit"]');
  }

  async typeText(element, text) {
    // Simulate typing text
    element.textContent = '';
    
    // Trigger input events
    const inputEvent = new Event('input', { bubbles: true });
    const changeEvent = new Event('change', { bubbles: true });
    
    // Type text character by character with small delays
    for (let i = 0; i < text.length; i++) {
      element.textContent += text[i];
      element.dispatchEvent(inputEvent);
      await this.sleep(Math.random() * 100 + 50); // Random delay between characters
    }
    
    element.dispatchEvent(changeEvent);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize the comment monitor
const commentMonitor = new YouTubeCommentMonitor();

// Export for debugging
window.youtubeAIReply = commentMonitor;

console.log('YouTube AI Reply content script initialized');